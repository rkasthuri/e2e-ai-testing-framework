/**
 * FORGE — Autonomous Quality Engineering
 * Framework for Observed, Reasoned, and Grounded Evaluation
 *
 * Copyright (c) 2026 AnvilQ Technologies LLC
 * Author: Raj Kasthuri
 *
 * Proprietary and confidential.
 * Unauthorized copying, distribution, or modification
 * of this software is strictly prohibited.
 */

/* ──────────────────────────────────────────────────────────────
 * platform.js — RYQ AI Testing Platform client
 * 3.8.a  Run Tests
 * 3.8.b  Dashboard
 * 3.8.c  Generate Test
 * ────────────────────────────────────────────────────────────── */
(function () {
  'use strict';

  var MARKER           = '@@RYQ@@ ';
  var GEN_MARKER       = '@@GEN@@ ';
  var REFRESH_INTERVAL = 30;

  // ═══════════════════════════════════════════════════════════════
  //  TAB SWITCHING
  // ═══════════════════════════════════════════════════════════════
  var currentTab = 'run';

  document.getElementById('tabs').addEventListener('click', function (e) {
    var btn = e.target.closest('.tab');
    if (!btn || btn.disabled || btn.classList.contains('active')) return;
    var tab = btn.getAttribute('data-tab');
    if (!tab) return;

    document.querySelectorAll('.tab').forEach(function (b) { b.classList.remove('active'); });
    document.querySelectorAll('.panel').forEach(function (p) { p.classList.remove('active'); });
    btn.classList.add('active');
    var panel = document.querySelector('[data-panel="' + tab + '"]');
    if (panel) panel.classList.add('active');

    if (currentTab === 'dashboard') dashDestroy();
    currentTab = tab;
    if (tab === 'dashboard') dashInit();
  });

  // ═══════════════════════════════════════════════════════════════
  //  RUN TESTS TAB  (3.8.a)
  // ═══════════════════════════════════════════════════════════════
  var selectedSuite = 'stable';
  var running       = false;
  var liveTests     = {};
  var lineBuf       = '';
  var activeCat     = null;

  var $output        = document.getElementById('output');
  var $runBtn        = document.getElementById('runBtn');
  var $clearBtn      = document.getElementById('clearBtn');
  var $suites        = document.getElementById('suites');
  var $browsers      = document.getElementById('browsers');
  var $fullPipeline  = document.getElementById('fullPipeline');
  var $consoleLabel  = document.getElementById('consoleLabel');
  var $statusDot     = document.getElementById('statusDot');
  var $statusText    = document.getElementById('statusText');
  var $summaryEmpty  = document.getElementById('summaryEmpty');
  var $summaryStats  = document.getElementById('summaryStats');
  var $summaryMeta   = document.getElementById('summaryMeta');
  var $detailPanel   = document.getElementById('detailPanel');
  var $detailTitle   = document.getElementById('detailTitle');
  var $detailBody    = document.getElementById('detailBody');
  var $detailClose   = document.getElementById('detailClose');

  var FAIL_STATES = { failed: 1, timedOut: 1, interrupted: 1 };

  function setStatus(state) {
    if (state === 'running') {
      $statusDot.classList.add('live'); $statusText.textContent = 'running';
      $consoleLabel.textContent = 'output · streaming';
    } else {
      $statusDot.classList.remove('live'); $statusText.textContent = 'idle';
      $consoleLabel.textContent = 'output · ready';
    }
  }

  var outputDirty = false;
  function clearOutput() {
    $output.innerHTML = '<span class="empty">No output yet. Configure a run and press \u25B6 Run Suite.\nOutput persists when you switch suites \u2014 only "Clear" or a new run resets it.</span>';
    outputDirty = false;
  }
  function appendOutput(text) {
    if (!outputDirty) { $output.textContent = ''; outputDirty = true; }
    $output.appendChild(document.createTextNode(text));
    $output.scrollTop = $output.scrollHeight;
  }
  function selectedBrowsers() {
    var out = [];
    $browsers.querySelectorAll('input[type=checkbox]').forEach(function (b) { if (b.checked) out.push(b.value); });
    return out;
  }
  function syncBrowserAvailability() {
    var isApi = selectedSuite === 'api';
    $browsers.querySelectorAll('.check').forEach(function (lbl) { lbl.classList.toggle('disabled', isApi); });
  }

  function showStatValues(s) {
    document.getElementById('sPassRate').textContent = s.passRate != null ? s.passRate : '—';
    document.getElementById('sTotal').textContent    = s.total    != null ? s.total    : '—';
    document.getElementById('sPassed').textContent   = s.passed   != null ? s.passed   : '—';
    document.getElementById('sFailed').textContent   = s.failed   != null ? s.failed   : '—';
    document.getElementById('sFlaky').textContent    = s.flaky    != null ? s.flaky    : '—';
    $summaryEmpty.style.display = 'none'; $summaryStats.style.display = '';
  }
  function renderSummary(data) {
    $summaryStats.classList.remove('live');
    if (!data || !data.stats) {
      $summaryStats.style.display = 'none'; $summaryEmpty.style.display = 'block';
      $summaryMeta.textContent = ''; closeDetail(); return;
    }
    showStatValues(data.stats);
    var dur  = data.durationMs ? (data.durationMs / 1000).toFixed(1) + 's' : '—';
    var bits = ['duration ' + dur];
    if (data.runId) bits.push('run ' + data.runId);
    bits.push('via ' + (data.source === 'history' ? 'run-history' : 'test-results'));
    $summaryMeta.textContent = bits.join('  \u00B7  ');
  }
  function fetchSummary() {
    return fetch('/api/last-run').then(function (r) { return r.json(); }).then(renderSummary).catch(function () {});
  }

  function resetLive() { liveTests = {}; lineBuf = ''; }
  function handleMarker(jsonStr) {
    var ev; try { ev = JSON.parse(jsonStr); } catch (e) { return; }
    if (ev.type === 'test') {
      var rec = liveTests[ev.id] || { everFailed: false };
      if (FAIL_STATES[ev.status]) rec.everFailed = true;
      rec.status = ev.status; liveTests[ev.id] = rec;
      renderLiveTally();
    }
  }
  function renderLiveTally() {
    var passed = 0, failed = 0, flaky = 0, skipped = 0, total = 0;
    for (var id in liveTests) {
      if (!liveTests.hasOwnProperty(id)) continue; total++;
      var r = liveTests[id];
      if (r.status === 'skipped') skipped++;
      else if (r.status === 'passed') { if (r.everFailed) flaky++; else passed++; }
      else failed++;
    }
    var ran = passed + failed + flaky;
    var pr = ran > 0 ? ((passed / ran) * 100).toFixed(1) + '%' : '0.0%';
    showStatValues({ passRate: pr, total: total, passed: passed, failed: failed, flaky: flaky });
    $summaryStats.classList.add('live');
    $summaryMeta.textContent = 'running\u2026  \u00B7  live tally (' + total + ' tests so far)';
  }

  function processLine(rawLine) {
    var idx = rawLine.indexOf(MARKER);
    if (idx < 0) { appendOutput(rawLine + '\n'); return; }
    if (idx > 0) appendOutput(rawLine.slice(0, idx) + '\n');
    handleMarker(rawLine.slice(idx + MARKER.length));
  }
  function processChunk(text) {
    lineBuf += text;
    var idx;
    while ((idx = lineBuf.indexOf('\n')) >= 0) {
      var line = lineBuf.slice(0, idx); lineBuf = lineBuf.slice(idx + 1);
      processLine(line.replace(/\r$/, ''));
    }
  }
  function flushBuffer() {
    if (!lineBuf) return; processLine(lineBuf.replace(/\r$/, '')); lineBuf = '';
  }

  var CAT_LABELS = { total: 'All Tests', passed: 'Passed', failed: 'Failed', flaky: 'Flaky' };
  function closeDetail() {
    activeCat = null; $detailPanel.style.display = 'none';
    $summaryStats.querySelectorAll('.stat.clickable').forEach(function (s) { s.classList.remove('active'); });
  }
  function highlightStat(cat) {
    $summaryStats.querySelectorAll('.stat.clickable').forEach(function (s) { s.classList.toggle('active', s.getAttribute('data-cat') === cat); });
  }
  function badge(text) { var b = document.createElement('span'); b.className = 'proj'; b.textContent = text || '—'; return b; }

  function renderDetail(cat, data) {
    $detailBody.textContent = '';
    var list = cat === 'total' ? [].concat(data.passed||[], data.flaky||[], data.failed||[], data.skipped||[]) : (data[cat]||[]);
    $detailTitle.textContent = CAT_LABELS[cat] || 'Details';
    var count = document.createElement('div'); count.className = 'detail-count';
    count.textContent = list.length + (list.length === 1 ? ' test' : ' tests');
    $detailBody.appendChild(count);
    if (!list.length) { var empty = document.createElement('div'); empty.className = 'detail-empty'; empty.textContent = 'No tests in this category.'; $detailBody.appendChild(empty); return; }
    list.forEach(function (t) {
      var expandable = !!t.errorFull;
      var item = document.createElement('div'); item.className = 'detail-item' + (expandable ? ' expandable' : '');
      var row  = document.createElement('div'); row.className  = 'detail-row'  + (expandable ? ' clickable-row' : '');
      var left = document.createElement('div');
      var title= document.createElement('div'); title.className = 't'; title.textContent = t.title; left.appendChild(title);
      if (t.error) { var err = document.createElement('div'); err.className = 'err'; err.textContent = t.error; left.appendChild(err); }
      var dur = document.createElement('span'); dur.className = 'dur'; dur.textContent = t.durationMs != null ? (t.durationMs/1000).toFixed(1)+'s' : '';
      row.appendChild(left); row.appendChild(badge(t.project)); row.appendChild(dur);
      if (expandable) { var chev = document.createElement('span'); chev.className = 'chev'; chev.textContent = '\u25BE'; row.appendChild(chev); }
      item.appendChild(row);
      if (expandable) { var pre = document.createElement('pre'); pre.className = 'err-full'; pre.textContent = t.errorFull; item.appendChild(pre); }
      $detailBody.appendChild(item);
    });
  }
  $detailBody.addEventListener('click', function (e) {
    var row = e.target.closest('.detail-row.clickable-row'); if (!row) return;
    var item = row.closest('.detail-item'); if (item) item.classList.toggle('open');
  });
  function openDetail(cat) {
    activeCat = cat; highlightStat(cat); $detailPanel.style.display = '';
    $detailTitle.textContent = CAT_LABELS[cat] || 'Details';
    $detailBody.innerHTML = '<div class="detail-empty">Loading\u2026</div>';
    fetch('/api/last-run-tests').then(function (r) { return r.json(); })
      .then(function (data) { if (activeCat === cat) renderDetail(cat, data); })
      .catch(function () { $detailBody.innerHTML = '<div class="detail-empty">Could not load details.</div>'; });
  }
  $summaryStats.addEventListener('click', function (e) {
    if (running) return;
    var stat = e.target.closest('.stat.clickable'); if (!stat) return;
    var cat = stat.getAttribute('data-cat');
    if (activeCat === cat) { closeDetail(); return; } openDetail(cat);
  });
  $detailClose.addEventListener('click', closeDetail);

  $suites.addEventListener('click', function (e) {
    var card = e.target.closest('.suite'); if (!card || running) return;
    selectedSuite = card.getAttribute('data-suite');
    $suites.querySelectorAll('.suite').forEach(function (c) { c.classList.toggle('sel', c === card); });
    syncBrowserAvailability();
  });
  $clearBtn.addEventListener('click', function () { if (running) return; clearOutput(); renderSummary(null); });

  function setRunning(on) {
    running = on; $runBtn.disabled = on; $clearBtn.disabled = on;
    $runBtn.textContent = on ? '\u25CF Running\u2026' : '\u25B6 Run Suite';
    setStatus(on ? 'running' : 'idle');
  }
  $runBtn.addEventListener('click', function () {
    if (running) return;
    var cfg = { suite: selectedSuite, browsers: selectedBrowsers(), fullPipeline: $fullPipeline.checked };
    setRunning(true); closeDetail(); resetLive();
    outputDirty = false; $output.textContent = ''; outputDirty = true;
    showStatValues({ passRate: '0.0%', total: 0, passed: 0, failed: 0, flaky: 0 });
    $summaryStats.classList.add('live'); $summaryMeta.textContent = 'running\u2026';
    fetch('/api/run', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cfg) })
      .then(function (resp) {
        if (resp.status === 409) { appendOutput('\n[platform] A run is already in progress.\n'); setRunning(false); return null; }
        if (!resp.ok || !resp.body) { appendOutput('\n[platform] Failed to start run (HTTP ' + resp.status + ').\n'); setRunning(false); return null; }
        return readRunStream(resp.body.getReader());
      })
      .catch(function (err) { appendOutput('\n[platform] Connection error: ' + err.message + '\n'); setRunning(false); });
  });
  function readRunStream(reader) {
    var decoder = new TextDecoder();
    function pump() {
      return reader.read().then(function (res) {
        if (res.done) { flushBuffer(); setRunning(false); fetchSummary(); dashFetch(); return; }
        processChunk(decoder.decode(res.value, { stream: true })); return pump();
      });
    }
    return pump();
  }

  syncBrowserAvailability();
  fetchSummary();


  // ═══════════════════════════════════════════════════════════════
  //  DASHBOARD TAB  (3.8.b)
  // ═══════════════════════════════════════════════════════════════
  var dashChart          = null;
  var dashTimer          = null;
  var dashCd             = REFRESH_INTERVAL;
  var dashPaused         = false;
  var dashDepth          = 10;
  var dashHotspot        = 'recent';
  var dashLastData       = null;
  var dashLastRefreshTime= null;

  var $dashDetailPanel = document.getElementById('dashDetailPanel');
  var $dashDetailTitle = document.getElementById('dashDetailTitle');
  var $dashDetailBody  = document.getElementById('dashDetailBody');

  function closeDashDetail() { $dashDetailPanel.style.display = 'none'; }
  function buildFailRow(t) {
    var expandable = !!t.errorFull;
    var item = document.createElement('div'); item.className = 'detail-item' + (expandable ? ' expandable' : '');
    var row  = document.createElement('div'); row.className  = 'detail-row'  + (expandable ? ' clickable-row' : '');
    var left = document.createElement('div');
    var ttl  = document.createElement('div'); ttl.className = 't'; ttl.textContent = t.title; left.appendChild(ttl);
    if (t.error) { var err = document.createElement('div'); err.className = 'err'; err.textContent = t.error; left.appendChild(err); }
    var b = document.createElement('span'); b.className = 'proj'; b.textContent = t.project || '—';
    var dur = document.createElement('span'); dur.className = 'dur'; dur.textContent = t.durationMs != null ? (t.durationMs/1000).toFixed(1)+'s' : '';
    row.appendChild(left); row.appendChild(b); row.appendChild(dur);
    if (expandable) { var chev = document.createElement('span'); chev.className = 'chev'; chev.textContent = '\u25BE'; row.appendChild(chev); }
    item.appendChild(row);
    if (expandable) { var pre = document.createElement('pre'); pre.className = 'err-full'; pre.textContent = t.errorFull; item.appendChild(pre); }
    return item;
  }
  function openDashDetail(runId, timestamp, isLatest) {
    $dashDetailPanel.style.display = '';
    $dashDetailTitle.textContent = 'Failed Tests \u2014 ' + fmtTimestamp(timestamp) + (isLatest ? '' : ' (historical)');
    $dashDetailBody.innerHTML = '<div class="detail-empty">Loading\u2026</div>';
    $dashDetailPanel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    if (!isLatest) {
      $dashDetailBody.innerHTML = '<div class="dash-no-data" style="text-align:left;padding:12px 0"><strong style="color:var(--ink)">Historical run \u2014 ' + esc(runId) + '</strong><br><br>Detailed per-test failure data is stored only in <code>test-results.json</code>, which holds the most recent run. Re-run the same suite from <strong>Run Tests</strong> to see full details.</div>';
      return;
    }
    fetch('/api/last-run-tests').then(function (r) { return r.json(); })
      .then(function (data) {
        var failed = data.failed || [];
        $dashDetailBody.innerHTML = '';
        if (!failed.length) { $dashDetailBody.innerHTML = '<div class="detail-empty">No failed tests in current results.</div>'; return; }
        var count = document.createElement('div'); count.className = 'detail-count'; count.textContent = failed.length + (failed.length===1?' test':' tests') + ' failed'; $dashDetailBody.appendChild(count);
        failed.forEach(function (t) { $dashDetailBody.appendChild(buildFailRow(t)); });
      })
      .catch(function () { $dashDetailBody.innerHTML = '<div class="detail-empty">Could not load failure details.</div>'; });
  }
  $dashDetailBody.addEventListener('click', function (e) {
    var row = e.target.closest('.detail-row.clickable-row'); if (!row) return;
    var item = row.closest('.detail-item'); if (item) item.classList.toggle('open');
  });
  document.getElementById('dashDetailClose').addEventListener('click', closeDashDetail);

  function fmtTimestamp(iso) {
    var d = new Date(iso);
    return (d.getMonth()+1)+'/'+d.getDate()+' '+String(d.getHours()).padStart(2,'0')+':'+String(d.getMinutes()).padStart(2,'0');
  }
  function relTime(iso) {
    var ms = Date.now() - new Date(iso).getTime();
    if (ms < 60000) return 'just now'; if (ms < 3600000) return Math.floor(ms/60000)+'m ago';
    if (ms < 86400000) return Math.floor(ms/3600000)+'h ago'; return Math.floor(ms/86400000)+'d ago';
  }
  function scorePillClass(s) { return s>=75?'score-high':s>=50?'score-mid':'score-low'; }
  function trendChipClass(t) { if(!t) return ''; var l=t.toLowerCase(); if(l.includes('improv')) return 'trend-improving'; if(l.includes('degrad')) return 'trend-degrading'; return 'trend-stable'; }
  function esc(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

  function renderChart(chartRuns) {
    var canvas = document.getElementById('dashChartCanvas');
    var empty  = document.getElementById('chartEmpty');
    var wrap   = document.getElementById('chartWrap');
    var runs   = (chartRuns||[]).filter(function(r){ return r.stats && r.stats.total > 0; });
    if (!runs.length) { wrap.style.display='none'; empty.style.display='block'; empty.textContent='No run history yet.'; return; }
    if (typeof Chart === 'undefined') {
      wrap.style.display='none'; empty.style.display='block';
      var tbl='<div style="font-family:var(--mono);font-size:11px;color:var(--ink-dim);margin-bottom:8px">Chart.js unavailable \u2014 run history table:</div>';
      tbl+='<table style="width:100%;border-collapse:collapse;font-family:var(--mono);font-size:11px">';
      tbl+='<tr style="color:var(--ink-faint)"><th style="text-align:left;padding:4px 8px">Date</th><th style="padding:4px 8px">Pass%</th><th style="padding:4px 8px">Total</th><th style="padding:4px 8px">Passed</th><th style="padding:4px 8px;color:var(--red)">Failed</th><th style="padding:4px 8px">Duration</th></tr>';
      runs.forEach(function(r,i){
        var pr=parseFloat(r.stats.passRate)||0;
        var col=pr>=90?'var(--green)':pr>=70?'var(--amber)':'var(--red)';
        var isLatest=i===runs.length-1;
        var failTd=r.stats.failed>0
          ?'<td class="dash-fail-link dash-fail-td" data-runid="'+esc(r.runId)+'" data-ts="'+r.timestamp+'" data-islatest="'+isLatest+'" data-failed="'+r.stats.failed+'" title="Click to see failure details">'+r.stats.failed+'</td>'
          :'<td style="text-align:center;color:var(--ink-faint)">0</td>';
        tbl+='<tr style="border-top:1px solid var(--line-soft)"><td style="padding:4px 8px;color:var(--ink-dim)">'+fmtTimestamp(r.timestamp)+'</td><td style="padding:4px 8px;color:'+col+';text-align:center">'+r.stats.passRate+'</td><td style="padding:4px 8px;text-align:center">'+r.stats.total+'</td><td style="padding:4px 8px;text-align:center;color:var(--green)">'+r.stats.passed+'</td>'+failTd+'<td style="padding:4px 8px;color:var(--ink-faint)">'+(r.durationMs/1000).toFixed(1)+'s</td></tr>';
      });
      tbl+='</table>'; empty.innerHTML=tbl; return;
    }
    wrap.style.display=''; empty.style.display='none';
    if (dashChart) { dashChart.destroy(); dashChart=null; }
    dashChart=new Chart(canvas.getContext('2d'),{type:'line',data:{labels:runs.map(function(r){return fmtTimestamp(r.timestamp);}),datasets:[{label:'Pass Rate (%)',data:runs.map(function(r){return parseFloat(r.stats.passRate)||0;}),borderColor:'#36d399',backgroundColor:'rgba(54,211,153,0.07)',fill:true,tension:0.35,pointBackgroundColor:'#36d399',pointRadius:4,pointHoverRadius:6,yAxisID:'yRate'},{label:'Failed',data:runs.map(function(r){return r.stats.failed||0;}),borderColor:'#ff5d5d',backgroundColor:'transparent',fill:false,tension:0.35,borderDash:[4,3],pointBackgroundColor:'#ff5d5d',pointRadius:4,pointHoverRadius:6,yAxisID:'yCount'}]},options:{responsive:true,maintainAspectRatio:false,interaction:{mode:'index',intersect:false},plugins:{legend:{labels:{color:'#8b97a7',font:{family:"'JetBrains Mono',monospace",size:11},boxWidth:18,padding:16}},tooltip:{backgroundColor:'#151b25',borderColor:'#283142',borderWidth:1,titleColor:'#e6edf3',bodyColor:'#8b97a7',titleFont:{family:"'JetBrains Mono',monospace",size:11},bodyFont:{family:"'JetBrains Mono',monospace",size:11},padding:10}},scales:{x:{grid:{color:'#1f2733'},ticks:{color:'#5d6878',font:{family:"'JetBrains Mono',monospace",size:10},maxRotation:35}},yRate:{position:'left',min:0,max:100,grid:{color:'#1f2733'},ticks:{color:'#36d399',font:{family:"'JetBrains Mono',monospace",size:10},callback:function(v){return v+'%';}}},yCount:{position:'right',beginAtZero:true,grid:{display:false},ticks:{color:'#ff5d5d',font:{family:"'JetBrains Mono',monospace",size:10},precision:0}}}}});
  }
  function deltaBadge(val,goodWhenNeg){
    if(val===null||val===undefined||val==0)return '<span class="delta neu">\u2014</span>';
    var num=parseFloat(val); if(isNaN(num)||num===0)return '<span class="delta neu">\u2014</span>';
    var positive=goodWhenNeg?num<0:num>0; var cls=positive?'pos':'neg'; var arrow=num>0?'\u25B2':'\u25BC';
    return '<span class="delta '+cls+'">'+arrow+' '+Math.abs(num)+'</span>';
  }
  function renderHealth(health) {
    var el=document.getElementById('healthBody');
    if(!health){el.innerHTML='<div class="dash-no-data">No data yet.</div>';return;}
    var s=health.stats; var d=health.delta;
    var failedClass='h-stat failed'+(s.failed>0?' dash-fail-link':'');
    var failedAttrs=s.failed>0?' data-runid="'+esc(health.runId)+'" data-ts="'+health.timestamp+'" title="Click to see failure details"':'';
    el.innerHTML='<div class="health-grid"><div class="h-stat passrate"><div class="k">Pass Rate '+(d?deltaBadge(d.passRate,false):'')+'</div><div class="v">'+(s.passRate||'—')+'</div></div><div class="h-stat"><div class="k">Total</div><div class="v">'+(s.total||0)+'</div></div><div class="h-stat"><div class="k">Passed '+(d?deltaBadge(d.passed,false):'')+'</div><div class="v">'+(s.passed||0)+'</div></div><div class="'+failedClass+'"'+failedAttrs+'><div class="k">Failed '+(d?deltaBadge(d.failed,true):'')+'</div><div class="v">'+(s.failed||0)+'</div></div><div class="h-stat flaky"><div class="k">Flaky '+(d?deltaBadge(d.flaky,true):'')+'</div><div class="v">'+(s.flaky||0)+'</div></div></div><div class="health-meta">duration '+(health.durationMs?(health.durationMs/1000).toFixed(1)+'s':'—')+(health.runId?'  \u00B7  run '+health.runId:'')+(health.timestamp?'  \u00B7  '+relTime(health.timestamp):'')+(d?'  \u00B7  delta vs previous run':'  \u00B7  first run (no delta)')+'</div>';
  }
  function renderHotspots(hotspots,mode){
    var el=document.getElementById('hotspotBody');
    var list=(hotspots&&hotspots[mode])?hotspots[mode]:[];
    if(!list.length){el.innerHTML='<div class="dash-no-data">No failures recorded yet \u2014 great health!</div>';return;}
    var maxVal=list[0][mode==='recent'?'score':'count']||1;
    el.innerHTML='';
    list.forEach(function(h,i){
      var val=mode==='recent'?h.score:h.count; var pct=Math.round((val/maxVal)*100);
      var item=document.createElement('div'); item.className='hotspot-item';
      item.innerHTML='<span class="hotspot-rank">'+(i+1)+'.</span><div class="hotspot-detail"><div class="hotspot-title" title="'+esc(h.title)+'">'+esc(h.title)+'</div><div class="hotspot-bar-track"><div class="hotspot-bar-fill" style="width:'+pct+'%"></div></div><div class="hotspot-meta">'+(mode==='recent'?'score '+h.score.toFixed(2)+' \u00B7 ':'')+'last seen '+relTime(h.lastSeen)+'</div></div><span class="hotspot-count">'+h.count+'x</span>';
      el.appendChild(item);
    });
  }
  function renderCoverage(coverage){
    var el=document.getElementById('coverageBody');
    if(!coverage){el.innerHTML='<div class="dash-no-data">Run <code>npm run coverage</code> to populate.</div>';return;}
    var html='<div class="health-meta" style="margin-bottom:10px">'+coverage.totalAreas+' areas \u00B7 '+coverage.totalGaps+' gaps \u00B7 avg score '+coverage.avgScore+'/100</div>';
    coverage.areas.forEach(function(a){html+='<div class="cover-row"><span class="cover-area-name">'+esc(a.area)+'</span><span>'+(a.gaps>0?'<span style="font-family:var(--mono);font-size:11px;color:var(--ink-faint);margin-right:8px">'+a.gaps+' gap'+(a.gaps!==1?'s':'')+'</span>':'')+'<span class="score-pill '+scorePillClass(a.score)+'">'+a.score+'</span></span></div>';});
    el.innerHTML=html;
  }
  function renderRelease(release){
    var el=document.getElementById('releaseBody');
    if(!release){el.innerHTML='<div class="dash-no-data">Run <code>npm run release-notes</code> to populate.</div>';return;}
    var tc=trendChipClass(release.passRateTrend);
    el.innerHTML='<div class="rel-kpi"><span class="rel-kpi-label">Version</span><span class="rel-kpi-val">'+esc(release.version||'—')+'</span></div><div class="rel-kpi"><span class="rel-kpi-label">Health Score</span><span class="rel-kpi-val">'+(release.healthScore||'—')+'/100</span></div><div class="rel-kpi"><span class="rel-kpi-label">Pass Rate Trend</span><span class="rel-kpi-val"><span class="trend-chip '+tc+'">'+esc(release.passRateTrend||'—')+'</span></span></div><div class="rel-kpi"><span class="rel-kpi-label">Runs Analysed</span><span class="rel-kpi-val">'+(release.runsAnalysed||'—')+'</span></div><div class="rel-kpi"><span class="rel-kpi-label">Period</span><span class="rel-kpi-val">'+esc(release.period||'—')+'</span></div>'+(release.generatedAt?'<div class="health-meta">Generated '+relTime(release.generatedAt)+'</div>':'');
  }
  function renderDashboard(data) {
    renderChart(data.chartRuns); renderHealth(data.health);
    renderHotspots(data.hotspots,dashHotspot); renderCoverage(data.coverage); renderRelease(data.release);
  }
  function updateCdDisplay() {
    if (!document.getElementById('refreshCd')) return;
    var base = dashPaused ? 'auto-refresh paused' : 'refresh in ' + dashCd + 's';
    document.getElementById('refreshCd').textContent = dashLastRefreshTime ? base + '  \u00B7  last \u21BA ' + dashLastRefreshTime : base;
  }
  function safeRender(id, fn) {
    try { fn(); } catch(e) {
      console.error('[dashboard] '+id+' render error:', e);
      var el=document.getElementById(id); if(el) el.innerHTML='<div class="dash-no-data" style="color:var(--amber)">Render error: '+e.message+'</div>';
    }
  }
  function dashFetch() {
    return fetch('/api/dashboard?depth='+dashDepth)
      .then(function(r){return r.json();})
      .then(function(data){
        dashLastData=data;
        var now=new Date(); dashLastRefreshTime=String(now.getHours()).padStart(2,'0')+':'+String(now.getMinutes()).padStart(2,'0')+':'+String(now.getSeconds()).padStart(2,'0');
        updateCdDisplay();
        safeRender('chartWrap',    function(){renderChart(data.chartRuns);});
        safeRender('healthBody',   function(){renderHealth(data.health);});
        safeRender('hotspotBody',  function(){renderHotspots(data.hotspots,dashHotspot);});
        safeRender('coverageBody', function(){renderCoverage(data.coverage);});
        safeRender('releaseBody',  function(){renderRelease(data.release);});
      })
      .catch(function(err){console.warn('Dashboard fetch error:',err);});
  }
  var $refreshCd = document.getElementById('refreshCd');
  function startTimer() {
    dashCd=REFRESH_INTERVAL;
    dashTimer=setInterval(function(){if(dashPaused)return;dashCd--;updateCdDisplay();if(dashCd<=0){dashCd=REFRESH_INTERVAL;dashFetch();}},1000);
  }
  function stopTimer() { if(dashTimer){clearInterval(dashTimer);dashTimer=null;} if($refreshCd)$refreshCd.textContent=''; }

  document.getElementById('pauseBtn').addEventListener('click', function(){
    dashPaused=!dashPaused; this.textContent=dashPaused?'\u25B6 Resume':'\u23F8 Pause';
    this.classList.toggle('active',dashPaused); updateCdDisplay();
  });
  document.getElementById('manualRefreshBtn').addEventListener('click', function(){dashCd=REFRESH_INTERVAL;updateCdDisplay();dashFetch();});

  document.getElementById('chartEmpty').addEventListener('click', function(e){
    var cell=e.target.closest('.dash-fail-link'); if(!cell||!parseInt(cell.getAttribute('data-failed'),10))return;
    openDashDetail(cell.getAttribute('data-runid'),cell.getAttribute('data-ts'),cell.getAttribute('data-islatest')==='true');
  });
  document.getElementById('healthBody').addEventListener('click', function(e){
    var cell=e.target.closest('.dash-fail-link'); if(!cell)return;
    openDashDetail(cell.getAttribute('data-runid'),cell.getAttribute('data-ts'),true);
  });

  document.querySelectorAll('[data-depth]').forEach(function(btn){
    btn.addEventListener('click', function(){
      document.querySelectorAll('[data-depth]').forEach(function(b){b.classList.remove('active');});
      this.classList.add('active'); dashDepth=parseInt(this.getAttribute('data-depth'),10); dashFetch();
    });
  });
  document.querySelectorAll('[data-hotspot]').forEach(function(btn){
    btn.addEventListener('click', function(){
      document.querySelectorAll('[data-hotspot]').forEach(function(b){b.classList.remove('active');});
      this.classList.add('active'); dashHotspot=this.getAttribute('data-hotspot');
      if(dashLastData)renderHotspots(dashLastData.hotspots,dashHotspot);
    });
  });

  function dashInit()    { dashFetch(); dashCd=REFRESH_INTERVAL; updateCdDisplay(); startTimer(); }
  function dashDestroy() { stopTimer(); if(dashChart){dashChart.destroy();dashChart=null;} }


  // ═══════════════════════════════════════════════════════════════
  //  GENERATE TEST TAB  (3.8.c)
  // ═══════════════════════════════════════════════════════════════
  var genGenerating = false;
  var genFileName   = null;   // fileName from last successful generation
  var genLineBuf    = '';
  var genOutputDirty= false;

  var $genPrompt      = document.getElementById('genPrompt');
  var $genBtn         = document.getElementById('genBtn');
  var $genClearAllBtn = document.getElementById('genClearAllBtn');
  var $genOutput      = document.getElementById('genOutput');
  var $genConsoleLabel= document.getElementById('genConsoleLabel');
  var $genResults     = document.getElementById('genResults');
  var $genPlacementBody = document.getElementById('genPlacementBody');
  var $genCodeEditor  = document.getElementById('genCodeEditor');
  var $genCodeFname   = document.getElementById('genCodeFname');
  var $genSaveBtn     = document.getElementById('genSaveBtn');
  var $genSaveRunBtn  = document.getElementById('genSaveRunBtn');
  var $genCopyBtn     = document.getElementById('genCopyBtn');
  var $genSavedMsg    = document.getElementById('genSavedMsg');
  var $genRunCard     = document.getElementById('genRunCard');
  var $genRunOutput   = document.getElementById('genRunOutput');

  // ── Tab key → 2 spaces in code editor ─────────────────────────
  $genCodeEditor.addEventListener('keydown', function(e){
    if(e.key!=='Tab')return; e.preventDefault();
    var s=this.selectionStart, end=this.selectionEnd;
    this.value=this.value.substring(0,s)+'  '+this.value.substring(end);
    this.selectionStart=this.selectionEnd=s+2;
  });

  // ── Append to gen console ──────────────────────────────────────
  function appendGen(text){
    if(!genOutputDirty){$genOutput.textContent='';genOutputDirty=true;}
    $genOutput.appendChild(document.createTextNode(text));
    $genOutput.scrollTop=$genOutput.scrollHeight;
  }

  // ── Handle structured @@GEN@@ result marker ────────────────────
  function handleGenMarker(jsonStr){
    var ev; try{ev=JSON.parse(jsonStr);}catch(e){return;}
    if(ev.type==='gen-result'){
      genFileName = ev.fileName;
      $genCodeFname.textContent = ev.fileName;
      $genCodeEditor.value = ev.code;
      renderPlacement(ev.decision, ev.newMethods||[]);
      $genResults.style.display = '';
      $genRunCard.style.display = 'none';
      $genSavedMsg.style.display = 'none';
    } else if(ev.type==='gen-error'){
      appendGen('\n❌ ' + (ev.message||'Generation failed.') + '\n');
    }
  }

  // ── Render placement card ──────────────────────────────────────
  var PRIORITY_COLORS = { P0: 'var(--red)', P1: 'var(--amber)', P2: 'var(--cyan)', EC: 'var(--green)' };
  function renderPlacement(dec, newMethods){
    var col = PRIORITY_COLORS[dec.priority] || 'var(--ink)';
    var html =
      '<div class="placement-row"><span class="placement-key">Test ID</span><span class="placement-val tid">'+esc(dec.testId)+'</span></div>'+
      '<div class="placement-row"><span class="placement-key">File</span><span class="placement-val">'+esc(dec.specFile)+'</span></div>'+
      '<div class="placement-row"><span class="placement-key">Describe</span><span class="placement-val">'+esc(dec.describeBlock)+'</span></div>'+
      '<div class="placement-row"><span class="placement-key">Priority</span><span class="placement-val" style="color:'+col+';font-weight:700">'+esc(dec.priority)+'</span></div>'+
      '<div class="placement-reasoning">'+esc(dec.reasoning||'')+'</div>';
    if(newMethods.length>0){
      html+='<div class="pom-warning"><strong>⚠️ New POM methods needed</strong>'+
            newMethods.map(function(m){return '• '+esc(m);}).join('<br>')+'</div>';
    }
    $genPlacementBody.innerHTML=html;
  }

  // ── Stream line parser for generate console ────────────────────
  function genProcessLine(rawLine){
    var idx=rawLine.indexOf(GEN_MARKER);
    if(idx<0){appendGen(rawLine+'\n');return;}
    if(idx>0)appendGen(rawLine.slice(0,idx)+'\n');
    handleGenMarker(rawLine.slice(idx+GEN_MARKER.length));
  }
  function genProcessChunk(text){
    genLineBuf+=text; var idx;
    while((idx=genLineBuf.indexOf('\n'))>=0){
      var line=genLineBuf.slice(0,idx); genLineBuf=genLineBuf.slice(idx+1);
      genProcessLine(line.replace(/\r$/,''));
    }
  }
  function genFlushBuffer(){if(!genLineBuf)return;genProcessLine(genLineBuf.replace(/\r$/,''));genLineBuf='';}

  // ── Generate ───────────────────────────────────────────────────
  function setGenGenerating(on){
    genGenerating=on; $genBtn.disabled=on;
    $genBtn.textContent=on?'\u25CF Generating\u2026':'\u2736 Generate Test';
    $genConsoleLabel.textContent=on?'output \u00B7 generating...':'output \u00B7 ready';
  }

  $genBtn.addEventListener('click', function(){
    if(genGenerating)return;
    var prompt=$genPrompt.value.trim();
    if(!prompt){$genPrompt.focus();return;}
    setGenGenerating(true);
    $genOutput.textContent=''; genOutputDirty=true; genLineBuf='';
    $genResults.style.display='none'; genFileName=null;
    fetch('/api/generate/preview',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({prompt:prompt})})
      .then(function(resp){
        if(!resp.ok||!resp.body){appendGen('\n[platform] Failed to start generation (HTTP '+resp.status+').\n');setGenGenerating(false);return null;}
        return readGenStream(resp.body.getReader());
      })
      .catch(function(err){appendGen('\n[platform] Connection error: '+err.message+'\n');setGenGenerating(false);});
  });

  function readGenStream(reader){
    var decoder=new TextDecoder();
    function pump(){
      return reader.read().then(function(res){
        if(res.done){genFlushBuffer();setGenGenerating(false);return;}
        genProcessChunk(decoder.decode(res.value,{stream:true}));return pump();
      });
    }
    return pump();
  }

  // ── Save ───────────────────────────────────────────────────────
  function doSave(thenRun){
    if(!genFileName){$genSavedMsg.className='saved-msg err';$genSavedMsg.textContent='No generated test to save.';$genSavedMsg.style.display='';return;}
    var code=$genCodeEditor.value.trim();
    if(!code){$genSavedMsg.className='saved-msg err';$genSavedMsg.textContent='Code editor is empty.';$genSavedMsg.style.display='';return;}
    $genSaveBtn.disabled=true; $genSaveRunBtn.disabled=true;
    fetch('/api/generate/save',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({code:code,fileName:genFileName})})
      .then(function(r){return r.json();})
      .then(function(data){
        if(data.success){
          $genSavedMsg.className='saved-msg ok';
          $genSavedMsg.textContent='\u2705 Saved to '+data.path;
          $genSavedMsg.style.display='';
          if(thenRun)doRun(data.fileName);
        } else {
          $genSavedMsg.className='saved-msg err';
          $genSavedMsg.textContent='\u274C Save failed: '+(data.error||'unknown');
          $genSavedMsg.style.display='';
        }
        $genSaveBtn.disabled=false; $genSaveRunBtn.disabled=false;
      })
      .catch(function(err){
        $genSavedMsg.className='saved-msg err'; $genSavedMsg.textContent='\u274C '+err.message; $genSavedMsg.style.display='';
        $genSaveBtn.disabled=false; $genSaveRunBtn.disabled=false;
      });
  }

  $genSaveBtn.addEventListener('click', function(){doSave(false);});
  $genSaveRunBtn.addEventListener('click', function(){doSave(true);});

  // ── Run after save ─────────────────────────────────────────────
  function doRun(fileName){
    $genRunCard.style.display='';
    $genRunOutput.textContent=''; var runDirty=false;
    function appendRun(t){if(!runDirty){$genRunOutput.textContent='';runDirty=true;}$genRunOutput.appendChild(document.createTextNode(t));$genRunOutput.scrollTop=$genRunOutput.scrollHeight;}
    fetch('/api/generate/run',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({fileName:fileName})})
      .then(function(resp){
        if(resp.status===409){appendRun('\n[platform] A run is already in progress.\n');return null;}
        if(!resp.ok||!resp.body){appendRun('\n[platform] Failed to start run (HTTP '+resp.status+').\n');return null;}
        // Acquire the reader ONCE — calling getReader() again on a locked stream throws.
        var reader=resp.body.getReader();
        var decoder=new TextDecoder(); var buf='';
        function pump(){return reader.read().then(function(res){
          if(res.done){if(buf)appendRun(buf);dashFetch();return;}
          buf+=decoder.decode(res.value,{stream:true}); var idx;
          while((idx=buf.indexOf('\n'))>=0){appendRun(buf.slice(0,idx+1));buf=buf.slice(idx+1);}
          return pump();
        });}
        return pump();
      })
      .catch(function(err){appendRun('\n[platform] '+err.message+'\n');});
    $genRunCard.scrollIntoView({behavior:'smooth',block:'nearest'});
  }

  // ── Copy ───────────────────────────────────────────────────────
  $genCopyBtn.addEventListener('click', function(){
    if(!$genCodeEditor.value)return;
    navigator.clipboard.writeText($genCodeEditor.value).then(function(){
      $genCopyBtn.textContent='Copied!';
      setTimeout(function(){$genCopyBtn.textContent='Copy';},2000);
    }).catch(function(){$genCopyBtn.textContent='Failed';setTimeout(function(){$genCopyBtn.textContent='Copy';},2000);});
  });

  // ── Clear All ──────────────────────────────────────────────────
  $genClearAllBtn.addEventListener('click', function(){
    if(genGenerating)return;
    $genPrompt.value=''; $genOutput.innerHTML='<span class="empty">Generation output will appear here. Enter a description and press \u2736 Generate Test.</span>';
    genOutputDirty=false; $genResults.style.display='none';
    $genRunCard.style.display='none'; genFileName=null;
    $genConsoleLabel.textContent='output \u00B7 ready';
  });

})();


// ── Phase 5.5 — Onboard Tab ──────────────────────────────────────────────
(function() {
  var pollInterval   = null;
  var currentCommand = null;
  var outputLines    = [];
  // ── Element accessors ────────────────────────────────────────────────────
  function appNameInput()  { return document.getElementById('onboard-app-name'); }
  function baseUrlInput()  { return document.getElementById('onboard-base-url'); }
  function appTypeSelect() { return document.getElementById('onboard-app-type'); }
  function outputEl()      { return document.getElementById('onboard-output'); }
  function statusEl()      { return document.getElementById('onboard-status'); }
  function reportSection() { return document.getElementById('verify-report-section'); }
  function reportContent() { return document.getElementById('verify-report-content'); }
  function clearBtn()      { return document.getElementById('btn-clear-output'); }
  function credsSection()  { return document.getElementById('creds-section'); }
  function apiNote()       { return document.getElementById('api-note'); }
  function credsTbody()    { return document.getElementById('creds-tbody'); }
  var buttons = {
    crawl:    function() { return document.getElementById('btn-crawl'); },
    verify:   function() { return document.getElementById('btn-verify'); },
    generate: function() { return document.getElementById('btn-generate'); },
    refresh:  function() { return document.getElementById('btn-refresh'); },
  };
  // ── Credential row management ────────────────────────────────────────────
  function addCredRow(roleId, username, password, loginUrl, successUrl) {
    var tbody = credsTbody();
    if (!tbody) return;
    var tr = document.createElement('tr');
    tr.innerHTML =
      '<td><input class="creds-input" placeholder="adminUser" value="' + (roleId || '') + '" data-field="roleId" /></td>' +
      '<td><input class="creds-input" placeholder="admin" value="' + (username || '') + '" data-field="username" /></td>' +
      '<td><input class="creds-input" type="password" placeholder="••••••" value="' + (password || '') + '" data-field="password" /></td>' +
      '<td><input class="creds-input" placeholder="/web/index.php/auth/login" value="' + (loginUrl || '') + '" data-field="loginUrl" /></td>' +
      '<td><input class="creds-input" placeholder="/web/index.php/dashboard/index" value="' + (successUrl || '') + '" data-field="successUrl" /></td>' +
      '<td><button class="btn-remove-role" title="Remove">&#10005;</button></td>';
    tr.querySelector('.btn-remove-role').addEventListener('click', function() {
      tbody.removeChild(tr);
    });
    tbody.appendChild(tr);
  }
  function getCredRows() {
    var tbody = credsTbody();
    if (!tbody) return [];
    var rows = [];
    Array.from(tbody.querySelectorAll('tr')).forEach(function(tr) {
      var roleId     = tr.querySelector('[data-field=roleId]').value.trim();
      var username   = tr.querySelector('[data-field=username]').value.trim();
      var password   = tr.querySelector('[data-field=password]').value.trim();
      var loginUrl   = tr.querySelector('[data-field=loginUrl]').value.trim();
      var successUrl = tr.querySelector('[data-field=successUrl]').value.trim();
      if (roleId && username && password) {
        rows.push({ roleId: roleId, username: username, password: password,
                    loginUrl: loginUrl, successUrl: successUrl });
      }
    });
    return rows;
  }
  // ── App type toggle ──────────────────────────────────────────────────────
  function updateAppTypeVisibility() {
    var type = appTypeSelect() ? appTypeSelect().value : 'web-ui';
    var cs   = credsSection();
    var an   = apiNote();
    if (cs) cs.style.display = type === 'web-ui'   ? 'block' : 'none';
    if (an) an.style.display = type === 'rest-api' ? 'block' : 'none';
  }
  // ── Status / output helpers ──────────────────────────────────────────────
  function setStatus(state, label) {
    var el = statusEl();
    if (!el) return;
    el.className = 'status-' + state;
    el.textContent = '● ' + label;
  }
  function setButtonsDisabled(disabled) {
    Object.values(buttons).forEach(function(fn) {
      var btn = fn();
      if (btn) btn.disabled = disabled;
    });
  }
  function appendOutput(text) {
    outputLines.push(text);
    var el = outputEl();
    if (!el) return;
    el.textContent = outputLines.join('\n');
    el.scrollTop = el.scrollHeight;
    var cb = clearBtn();
    if (cb) cb.style.display = 'inline-block';
  }
  function clearOutput() {
    outputLines = [];
    var el = outputEl();
    if (el) el.textContent = 'Waiting for command...';
    var cb = clearBtn();
    if (cb) cb.style.display = 'none';
  }
  // ── Run command ──────────────────────────────────────────────────────────
  function runCommand(command) {
    if (currentCommand) return;
    currentCommand = command;
    var appName = (appNameInput() && appNameInput().value.trim()) || '';
    var baseUrl = (baseUrlInput() && baseUrlInput().value.trim()) || '';
    var appType = (appTypeSelect() && appTypeSelect().value) || 'web-ui';
    var roles   = appType === 'web-ui' ? getCredRows() : [];
    if (!appName) {
      appendOutput('[Error] App Name is required.');
      currentCommand = null;
      return;
    }
    clearOutput();
    setStatus('running', command);
    setButtonsDisabled(true);
    fetch('/api/onboard/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        command: command,
        appName: appName,
        baseUrl: baseUrl,
        appType: appType,
        roles:   roles
      })
    })
    .then(function(res) {
      if (!res.ok) {
        appendOutput('[Error] Failed to start command: ' + command);
        setStatus('error', 'failed');
        setButtonsDisabled(false);
        currentCommand = null;
        return;
      }
      startPolling(command);
    })
    .catch(function(e) {
      appendOutput('[Error] ' + e.message);
      setStatus('error', 'failed');
      setButtonsDisabled(false);
      currentCommand = null;
    });
  }
  function startPolling(cmd) {
    if (pollInterval) clearInterval(pollInterval);
    pollInterval = setInterval(function() {
      fetch('/api/onboard/output')
      .then(function(res) { return res.json(); })
      .then(function(data) {
        if (data.lines && data.lines.length > 0) {
          data.lines.forEach(function(line) { appendOutput(line); });
        }
        if (data.status === 'done' || data.status === 'error') {
          clearInterval(pollInterval);
          pollInterval = null;
          setStatus(data.status, data.status);
          setButtonsDisabled(false);
          currentCommand = null;
          if (cmd === 'verify') loadVerifyReport();
        }
      })
      .catch(function() {});
    }, 800);
  }
  function loadVerifyReport() {
    var appName = appNameInput() ? appNameInput().value.trim() : '';
    if (!appName) return;
    fetch('/api/onboard/report?app=' + encodeURIComponent(appName))
    .then(function(res) { return res.json(); })
    .then(function(data) {
      var sec = reportSection();
      var con = reportContent();
      if (!sec || !con) return;
      sec.style.display = 'block';
      con.textContent = JSON.stringify(data, null, 2);
    })
    .catch(function() {});
  }
  // ── Event listeners ──────────────────────────────────────────────────────
  document.addEventListener('DOMContentLoaded', function() {
    // App type toggle
    var ats = appTypeSelect();
    if (ats) ats.addEventListener('change', updateAppTypeVisibility);
    updateAppTypeVisibility();
    // Add role button — start with one empty row for web-ui
    addCredRow('', '', '', '', '');
    var addBtn = document.getElementById('btn-add-role');
    if (addBtn) addBtn.addEventListener('click', function() {
      addCredRow('', '', '', '', '');
    });
    // Action buttons
    var bc = document.getElementById('btn-crawl');
    var bv = document.getElementById('btn-verify');
    var bg = document.getElementById('btn-generate');
    var br = document.getElementById('btn-refresh');
    var bco = document.getElementById('btn-clear-output');
    if (bc)  bc.addEventListener('click',  function() { runCommand('crawl'); });
    if (bv)  bv.addEventListener('click',  function() { runCommand('verify'); });
    if (bg)  bg.addEventListener('click',  function() { runCommand('generate'); });
    if (br)  br.addEventListener('click',  function() { loadVerifyReport(); });
    if (bco) bco.addEventListener('click', function() { clearOutput(); });
    // Re-load report when ONBOARD tab is clicked
    var onboardTabBtn = document.getElementById('tab-onboard');
    if (onboardTabBtn) {
      onboardTabBtn.addEventListener('click', loadVerifyReport);
    }
  });
})();

// ── Phase 5.6 — Review Tab ───────────────────────────────────────────────────
(function() {
  var currentApp     = '';
  var currentTest    = null;  // { name, content, status, sourcePath, targetFile }
  var allTests       = [];
  var executeState   = 'idle'; // idle | running | passed | failed
  var currentFilter  = 'pending';
  // ── Element accessors ───────────────────────────────────────────────────────
  function el(id) { return document.getElementById(id); }
  // ── Load apps into dropdown ─────────────────────────────────────────────────
  function loadApps() {
    fetch('/api/review/apps')
      .then(function(r) { return r.json(); })
      .then(function(data) {
        var sel = el('review-app-select');
        if (!sel) return;
        sel.innerHTML = '<option value="">— select app —</option>';
        (data.apps || []).forEach(function(app) {
          var opt = document.createElement('option');
          opt.value = app;
          opt.textContent = app;
          sel.appendChild(opt);
        });
      })
      .catch(function() {});
  }
  // ── Load tests for selected app ─────────────────────────────────────────────
  function loadTests(app) {
    fetch('/api/review/tests?app=' + encodeURIComponent(app))
      .then(function(r) { return r.json(); })
      .then(function(data) {
        allTests = data.tests || [];
        el('review-layout').style.display = 'grid';
        el('review-no-app').style.display = 'none';
        renderList();
        clearEditor();
      })
      .catch(function() {});
  }
  // ── Render left panel list ──────────────────────────────────────────────────
  function renderList() {
    var body = el('review-list-body');
    if (!body) return;
    body.innerHTML = '';
    var filtered = allTests.filter(function(t) {
      if (currentFilter === 'pending') return t.status === 'pending';
      return true;
    });
    if (filtered.length === 0) {
      body.innerHTML = '<div class="review-empty-state">' +
        (currentFilter === 'pending'
          ? 'All generated tests have been reviewed.'
          : 'No generated tests found for this app.') +
        '</div>';
      return;
    }
    filtered.forEach(function(test) {
      var row = document.createElement('div');
      row.className = 'review-test-row' +
        (test.status === 'promoted' ? ' promoted' : '') +
        (test.status === 'rejected' ? ' rejected' : '') +
        (currentTest && currentTest.name === test.name ? ' selected' : '');
      row.dataset.name = test.name;
      var chk = document.createElement('input');
      chk.type = 'checkbox';
      chk.checked = test._checked || false;
      if (test.status !== 'pending') chk.disabled = true;
      chk.addEventListener('click', function(e) {
        e.stopPropagation();
        test._checked = chk.checked;
        updateBulkBtn();
      });
      var nameSpan = document.createElement('span');
      nameSpan.className = 'review-test-name';
      nameSpan.textContent = test.name;
      nameSpan.title = test.name;
      var statusSpan = document.createElement('span');
      statusSpan.className = 'review-test-status';
      if (test.status === 'promoted') statusSpan.textContent = '→ ' + (test.targetFile || 'promoted');
      else if (test.status === 'rejected') statusSpan.textContent = '✗ rejected';
      else statusSpan.textContent = 'pending';
      row.appendChild(chk);
      row.appendChild(nameSpan);
      row.appendChild(statusSpan);
      if (test.status === 'pending') {
        row.addEventListener('click', function() { selectTest(test); });
      }
      body.appendChild(row);
    });
  }
  // ── Select a test — load into editor ───────────────────────────────────────
  function selectTest(test) {
    currentTest  = test;
    executeState = 'idle';
    // highlight row
    document.querySelectorAll('.review-test-row').forEach(function(r) {
      r.classList.remove('selected');
      if (r.dataset.name === test.name) r.classList.add('selected');
    });
    // populate editor
    el('review-editor-header').style.display = 'flex';
    el('review-editor-empty').style.display  = 'none';
    el('review-code-editor').style.display   = 'block';
    el('review-editor-actions').style.display = 'flex';
    el('review-editor-title').textContent = test.name;
    el('review-code-editor').value = test.content;
    // hide exec output
    var eo = el('review-exec-output');
    eo.classList.remove('visible');
    eo.textContent = '';
    // populate target select
    populateTargetSelect(test.suggestedTarget);
    // reset Reviewed button — requires passing execute
    el('review-btn-reviewed').disabled = true;
    // reset save message
    el('review-btn-save').textContent = '💾 Save';
  }
  // ── Populate target file dropdown ───────────────────────────────────────────
  function populateTargetSelect(suggested) {
    fetch('/api/review/targets?app=' + encodeURIComponent(currentApp))
      .then(function(r) { return r.json(); })
      .then(function(data) {
        var sel = el('review-target-select');
        if (!sel) return;
        sel.innerHTML = '';
        var targets = data.targets || [];
        if (suggested && targets.indexOf(suggested) === -1) {
          targets.unshift(suggested);
        }
        targets.forEach(function(t) {
          var opt = document.createElement('option');
          opt.value = t;
          opt.textContent = t;
          if (t === suggested) opt.selected = true;
          sel.appendChild(opt);
        });
        // Always add "New: promoted.spec.ts" fallback
        var fallback = document.createElement('option');
        fallback.value = 'promoted.spec.ts';
        fallback.textContent = 'promoted.spec.ts (catch-all)';
        sel.appendChild(fallback);
      })
      .catch(function() {});
  }
  // ── Clear editor ────────────────────────────────────────────────────────────
  function clearEditor() {
    currentTest  = null;
    executeState = 'idle';
    el('review-editor-header').style.display  = 'none';
    el('review-editor-empty').style.display   = 'flex';
    el('review-code-editor').style.display    = 'none';
    el('review-editor-actions').style.display = 'none';
    el('review-exec-output').classList.remove('visible');
    el('review-exec-output').textContent = '';
  }
  // ── Update bulk button state ────────────────────────────────────────────────
  function updateBulkBtn() {
    var any = allTests.some(function(t) { return t._checked && t.status === 'pending'; });
    el('review-bulk-btn').disabled = !any;
  }
  // ── Execute button ──────────────────────────────────────────────────────────
  function doExecute() {
    if (!currentTest) return;
    executeState = 'running';
    el('review-btn-execute').textContent = '⏳ Running...';
    el('review-btn-execute').disabled = true;
    el('review-btn-reviewed').disabled = true;
    var eo = el('review-exec-output');
    eo.className = 'review-exec-output visible';
    eo.textContent = 'Running test...\n';
    fetch('/api/review/execute', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        app:        currentApp,
        name:       currentTest.name,
        content:    el('review-code-editor').value,
        sourcePath: currentTest.sourcePath
      })
    })
    .then(function(r) { return r.json(); })
    .then(function(data) {
      eo.textContent = data.output || '';
      if (data.passed) {
        executeState = 'passed';
        eo.className = 'review-exec-output visible review-exec-pass';
        eo.textContent += '\n✅ ' + (data.summary || '1 passed — Reviewed now enabled');
        el('review-btn-reviewed').disabled = false;
      } else {
        executeState = 'failed';
        eo.className = 'review-exec-output visible review-exec-fail';
        eo.textContent += '\n❌ Test failed — fix errors before promoting';
        el('review-btn-reviewed').disabled = true;
      }
      el('review-btn-execute').textContent = '▶ Execute';
      el('review-btn-execute').disabled = false;
    })
    .catch(function(e) {
      eo.textContent = '[error] ' + e.message;
      eo.className = 'review-exec-output visible review-exec-fail';
      el('review-btn-execute').textContent = '▶ Execute';
      el('review-btn-execute').disabled = false;
    });
  }
  // ── Save button ─────────────────────────────────────────────────────────────
  function doSave() {
    if (!currentTest) return;
    el('review-btn-save').textContent = '💾 Saving...';
    el('review-btn-save').disabled = true;
    // If content changed after a passing execute, reset reviewed gate
    if (executeState === 'passed') {
      el('review-btn-reviewed').disabled = true;
      executeState = 'idle';
    }
    fetch('/api/review/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        app:        currentApp,
        name:       currentTest.name,
        sourcePath: currentTest.sourcePath,
        content:    el('review-code-editor').value
      })
    })
    .then(function(r) { return r.json(); })
    .then(function() {
      currentTest.content = el('review-code-editor').value;
      el('review-btn-save').textContent = '✓ Saved';
      setTimeout(function() {
        el('review-btn-save').textContent = '💾 Save';
        el('review-btn-save').disabled = false;
      }, 1500);
    })
    .catch(function() {
      el('review-btn-save').textContent = '💾 Save';
      el('review-btn-save').disabled = false;
    });
  }
  // ── Reviewed button (single) ─────────────────────────────────────────────────
  function doReviewed() {
    if (!currentTest || executeState !== 'passed') return;
    var targetFile = el('review-target-select').value || 'promoted.spec.ts';
    el('review-btn-reviewed').disabled = true;
    el('review-btn-reviewed').textContent = '⏳ Promoting...';
    fetch('/api/review/promote', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        app:        currentApp,
        name:       currentTest.name,
        sourcePath: currentTest.sourcePath,
        content:    el('review-code-editor').value,
        targetFile: targetFile
      })
    })
    .then(function(r) { return r.json(); })
    .then(function(data) {
      el('review-btn-reviewed').textContent = '✓ Reviewed';
      // Update test status in allTests
      var t = allTests.find(function(x) { return x.name === currentTest.name; });
      if (t) { t.status = 'promoted'; t.targetFile = targetFile; }
      // Show result in exec output
      var eo = el('review-exec-output');
      eo.className = 'review-exec-output visible review-exec-pass';
      eo.textContent = '✅ ' + currentTest.name + ' → ' + targetFile;
      renderList();
    })
    .catch(function(e) {
      el('review-btn-reviewed').textContent = '✓ Reviewed';
      el('review-btn-reviewed').disabled = false;
    });
  }
  // ── Reject button ────────────────────────────────────────────────────────────
  function doReject() {
    if (!currentTest) return;
    fetch('/api/review/reject', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        app:        currentApp,
        name:       currentTest.name,
        sourcePath: currentTest.sourcePath
      })
    })
    .then(function(r) { return r.json(); })
    .then(function() {
      var t = allTests.find(function(x) { return x.name === currentTest.name; });
      if (t) t.status = 'rejected';
      renderList();
      clearEditor();
    })
    .catch(function() {});
  }
  // ── Bulk reviewed ────────────────────────────────────────────────────────────
  function doBulkReviewed() {
    var checked = allTests.filter(function(t) {
      return t._checked && t.status === 'pending';
    });
    if (checked.length === 0) return;
    el('review-bulk-btn').disabled = true;
    el('review-bulk-btn').textContent = '⏳ Promoting...';
    fetch('/api/review/promote-bulk', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        app:   currentApp,
        tests: checked.map(function(t) {
          return { name: t.name, sourcePath: t.sourcePath, content: t.content, targetFile: t.suggestedTarget || 'promoted.spec.ts' };
        })
      })
    })
    .then(function(r) { return r.json(); })
    .then(function(data) {
      var results = data.results || [];
      var msg = results.map(function(r) {
        return r.name + ' → ' + r.targetFile;
      }).join(' · ');
      el('review-bulk-result').textContent = msg;
      results.forEach(function(r) {
        var t = allTests.find(function(x) { return x.name === r.name; });
        if (t) { t.status = 'promoted'; t.targetFile = r.targetFile; t._checked = false; }
      });
      el('review-bulk-btn').textContent = '✓ Reviewed Selected';
      el('review-bulk-btn').disabled = true;
      renderList();
    })
    .catch(function() {
      el('review-bulk-btn').textContent = '✓ Reviewed Selected';
      el('review-bulk-btn').disabled = false;
    });
  }
  // ── Code editor change — reset execute gate ──────────────────────────────────
  function onEditorChange() {
    if (executeState === 'passed') {
      executeState = 'idle';
      el('review-btn-reviewed').disabled = true;
      var eo = el('review-exec-output');
      eo.className = 'review-exec-output visible';
      eo.textContent = '⚠ Content changed — re-run Execute before promoting.';
    }
  }
  // ── Init ────────────────────────────────────────────────────────────────────
  document.addEventListener('DOMContentLoaded', function() {
    // Load apps when REVIEW tab is clicked
    var tabBtn = el('tab-review');
    if (tabBtn) {
      tabBtn.addEventListener('click', function() {
        loadApps();
      });
    }
    // App select change
    var appSel = el('review-app-select');
    if (appSel) {
      appSel.addEventListener('change', function() {
        currentApp = appSel.value;
        if (!currentApp) {
          el('review-layout').style.display = 'none';
          el('review-no-app').style.display = 'flex';
          clearEditor();
          return;
        }
        loadTests(currentApp);
      });
    }
    // Filter buttons
    document.querySelectorAll('.review-filter-btn').forEach(function(btn) {
      btn.addEventListener('click', function() {
        document.querySelectorAll('.review-filter-btn').forEach(function(b) {
          b.classList.remove('active');
        });
        btn.classList.add('active');
        currentFilter = btn.dataset.filter;
        renderList();
      });
    });
    // Action buttons
    var bExec = el('review-btn-execute');
    var bSave = el('review-btn-save');
    var bRev  = el('review-btn-reviewed');
    var bRej  = el('review-btn-reject');
    var bBulk = el('review-bulk-btn');
    var editor = el('review-code-editor');
    if (bExec)  bExec.addEventListener('click',  doExecute);
    if (bSave)  bSave.addEventListener('click',  doSave);
    if (bRev)   bRev.addEventListener('click',   doReviewed);
    if (bRej)   bRej.addEventListener('click',   doReject);
    if (bBulk)  bBulk.addEventListener('click',  doBulkReviewed);
    if (editor) editor.addEventListener('input', onEditorChange);
  });
})();
