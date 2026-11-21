/*
 * Flasher page (flasher.html).
 *
 * One subtab per project (Ghostlight Node, OpenTheatreComms Beltpack).
 *
 * Install: ESP Web Tools does the flashing. initInstall() fills a project's
 * board list from flasher/<project>/boards.json; for the Ghostlight Node the
 * "Ghostlight Node firmware" workflow writes it from the newest release.
 *
 * Set up over USB (Ghostlight Node): talks to the firmware's USB setup over Web Serial
 * (components/serial_setup in ghostlight-node-firmware). One request per
 * line, "#GL {json}", one reply line "#GL> {json}" with the same id.
 * Everything else the port prints is the node's log.
 */
(function () {
  'use strict';

  var GL_REPO = 'https://github.com/DefeatedWarrior/ghostlight-node-firmware';
  var BAUD = 115200;

  var $ = function (id) { return document.getElementById(id); };
  var sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
  var esc = function (s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  };
  var store = {
    get: function (k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set: function (k, v) { try { localStorage.setItem(k, v); } catch (e) { /* private window */ } }
  };
  var utf8len = function (s) { return new TextEncoder().encode(s).length; };

  // ===================================================================
  // Project subtabs, and the Install / Set up steps of the Ghostlight Node
  //
  // URLs: flasher.html (Ghostlight, Install), #setup (Ghostlight, Set up
  // over USB), #update (Ghostlight, Install, at the update note) and
  // #<project> for the other projects, for example #beltpack.
  // ===================================================================

  var projects = {};
  document.querySelectorAll('[data-project]').forEach(function (b) { projects[b.getAttribute('data-project')] = b; });
  var projectIds = Object.keys(projects);
  var currentProject = 'ghostlight-node';
  var currentStep = 'install';
  var tabs = { install: $('tab-install'), setup: $('tab-setup') };
  var panels = { install: $('panel-install'), setup: $('panel-setup') };

  function setHash() {
    var hash = currentProject !== 'ghostlight-node' ? '#' + currentProject
      : currentStep === 'setup' ? '#setup' : '';
    if (hash === '' && location.hash === '#update') return;
    if (location.hash !== hash) history.replaceState(null, '', location.pathname + location.search + hash);
  }

  function showProject(id, focus) {
    if (!projects[id]) id = 'ghostlight-node';
    currentProject = id;
    projectIds.forEach(function (k) {
      var on = k === id;
      projects[k].setAttribute('aria-selected', on ? 'true' : 'false');
      projects[k].tabIndex = on ? 0 : -1;
      $('proj-' + k).hidden = !on;
    });
    if (focus) projects[id].focus();
    setHash();
  }
  projectIds.forEach(function (k, i) {
    projects[k].addEventListener('click', function () { showProject(k); });
    projects[k].addEventListener('keydown', function (e) {
      var step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
      if (!step) return;
      e.preventDefault();
      showProject(projectIds[(i + step + projectIds.length) % projectIds.length], true);
    });
  });

  function showTab(name, focus) {
    currentStep = name;
    Object.keys(tabs).forEach(function (k) {
      var on = k === name;
      tabs[k].setAttribute('aria-selected', on ? 'true' : 'false');
      tabs[k].tabIndex = on ? 0 : -1;
      panels[k].hidden = !on;
    });
    if (focus) tabs[name].focus();
    setHash();
  }
  Object.keys(tabs).forEach(function (k) {
    tabs[k].addEventListener('click', function () { showTab(k); });
    tabs[k].addEventListener('keydown', function (e) {
      if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
        e.preventDefault();
        showTab(k === 'install' ? 'setup' : 'install', true);
      }
    });
  });
  document.querySelectorAll('[data-tab]').forEach(function (a) {
    a.addEventListener('click', function (e) {
      e.preventDefault();
      showTab(a.getAttribute('data-tab'));
      window.scrollTo({ top: $('tab-install').getBoundingClientRect().top + window.scrollY - 90 });
    });
  });

  function route() {
    var h = location.hash.slice(1);
    if (h === 'setup') currentStep = 'setup';
    else if (h === 'update' || h === 'install') currentStep = 'install';
    showProject(projects[h] ? h : 'ghostlight-node');
    showTab(currentStep);
  }
  window.addEventListener('hashchange', route);
  route();

  // ===================================================================
  // Install: a board list from <fw>boards.json (written by the project's
  // firmware workflow) feeding an ESP Web Tools install button
  // ===================================================================

  function initInstall(o) {
    var el = {};
    Object.keys(o.ids).forEach(function (k) { el[k] = $(o.ids[k]); });
    var release = null;

    function boardChanged() {
      var b = release && release.boards.filter(function (x) { return x.board === el.select.value; })[0];
      if (b) {
        el.install.setAttribute('manifest', o.fw + b.manifest);
        el.button.disabled = false;
        el.desc.textContent = b.description || '';
        if (el.ota && b.ota && release.tag) {
          el.ota.href = o.repo + '/releases/download/' + encodeURIComponent(release.tag) + '/' + encodeURIComponent(b.ota);
          el.ota.textContent = b.ota;
        }
        store.set(o.storeKey, b.board);
      } else {
        el.install.removeAttribute('manifest');
        el.button.disabled = true;
        if (el.ota) {
          el.ota.href = release && release.release_url ? release.release_url : o.repo + '/releases';
          el.ota.textContent = 'the update file for your board';
        }
      }
    }
    el.select.addEventListener('change', boardChanged);

    fetch(o.fw + 'boards.json', { cache: 'no-cache' })
      .then(function (r) {
        if (!r.ok) throw new Error(r.status + ' ' + r.statusText);
        return r.json();
      })
      .then(function (data) {
        release = data;
        if (!data.boards || !data.boards.length) {
          el.version.innerHTML = 'No release yet · <a href="' + o.repo + '">build it from source</a>';
          el.select.innerHTML = '<option value="">No firmware published yet</option>';
          el.desc.innerHTML = o.noReleaseHtml;
          return;
        }
        el.version.innerHTML = 'Firmware ' + esc(data.version) + ' · <a href="' + esc(data.release_url) + '">release notes</a>';
        el.select.innerHTML = '<option value="">Choose a board…</option>' + data.boards.map(function (b) {
          return '<option value="' + esc(b.board) + '">' + esc(b.board) + ' (' + esc(b.chip_family) + ')</option>';
        }).join('');
        el.select.disabled = false;
        var last = store.get(o.storeKey);
        if (last && data.boards.some(function (b) { return b.board === last; })) el.select.value = last;
        boardChanged();
      })
      .catch(function (err) {
        el.version.textContent = 'Couldn\'t load the firmware list (' + err.message + ')';
        el.select.innerHTML = '<option value="">Not available</option>';
      });

    // The installer needs the port to itself: let go of it first.
    el.button.addEventListener('click', function () { if (S.link) disconnect(); });
  }

  initInstall({
    fw: 'flasher/ghostlight-node/',
    repo: GL_REPO,
    storeKey: 'flasher.board',
    noReleaseHtml: 'The first release isn\'t out yet. Until then, build the firmware with ESP-IDF: see <a href="' + GL_REPO + '/blob/main/docs/DEVELOPING.md">DEVELOPING.md</a>.',
    ids: { version: 'fw-version', select: 'board', desc: 'board-desc', install: 'install', button: 'install-btn', ota: 'ota-link' }
  });

  // ===================================================================
  // Serial link
  // ===================================================================

  function NodeError(msg) { var e = new Error(msg); e.fromNode = true; return e; }

  function Link(port, onLine, onLost) {
    this.port = port;
    this.onLine = onLine;
    this.onLost = onLost;
    this.pending = new Map();
    this.nextId = Math.floor(Math.random() * 1000) * 1000;
    this.buf = '';
    this.closing = false;
    this.reader = null;
    this.wq = Promise.resolve();
    this.enc = new TextEncoder();
  }

  // Leave the reset lines released. RTS on with DTR off resets the chip on
  // both the auto-reset circuit of USB-serial boards and the ESP32-S3's own
  // USB, so drop RTS first.
  Link.prototype.quiet = async function () {
    try { await this.port.setSignals({ requestToSend: false }); } catch (e) { /* not supported */ }
    try { await this.port.setSignals({ dataTerminalReady: false }); } catch (e) { /* not supported */ }
  };

  Link.prototype.start = function () { this.loop = this.readLoop(); };

  Link.prototype.readLoop = async function () {
    var dec = new TextDecoder();
    while (this.port.readable && !this.closing) {
      this.reader = this.port.readable.getReader();
      try {
        for (;;) {
          var r = await this.reader.read();
          if (r.done) break;
          if (r.value) this.feed(dec.decode(r.value, { stream: true }));
        }
      } catch (e) {
        // Framing or overrun errors: keep reading. A lost device clears
        // port.readable and ends the loop.
      } finally {
        try { this.reader.releaseLock(); } catch (e) { /* already released */ }
        this.reader = null;
      }
    }
    this.failAll(new Error('The node was disconnected'));
    if (!this.closing) this.onLost(this);
  };

  Link.prototype.feed = function (text) {
    this.buf += text;
    var i;
    while ((i = this.buf.indexOf('\n')) >= 0) {
      var line = this.buf.slice(0, i).replace(/\r$/, '');
      this.buf = this.buf.slice(i + 1);
      this.line(line);
    }
    if (this.buf.length > 16384) { this.line(this.buf); this.buf = ''; }
  };

  Link.prototype.line = function (raw) {
    var line = raw.replace(/\x1b\[[0-9;]*m/g, '');
    var k = line.indexOf('#GL> ');
    if (k < 0) { this.onLine(line); return; }
    if (k > 0) this.onLine(line.slice(0, k));
    var msg;
    try { msg = JSON.parse(line.slice(k + 5)); } catch (e) { this.onLine(line); return; }
    var p = this.pending.get(msg.id);
    if (!p) return;   // a late reply to a request that timed out
    this.pending.delete(msg.id);
    clearTimeout(p.timer);
    if (msg.ok) p.resolve(msg); else p.reject(NodeError(msg.error || 'The node refused that'));
  };

  // Slowly, so a long line fits through the node's 1 KB receive buffer.
  Link.prototype.write = function (text) {
    var self = this;
    var bytes = this.enc.encode(text);
    var job = this.wq.then(async function () {
      if (!self.port.writable) throw new Error('The port is closed');
      var w = self.port.writable.getWriter();
      try {
        for (var o = 0; o < bytes.length; o += 64) {
          await w.write(bytes.subarray(o, o + 64));
          if (o + 64 < bytes.length) await sleep(8);
        }
      } finally {
        w.releaseLock();
      }
    });
    this.wq = job.catch(function () {});
    return job;
  };

  Link.prototype.send = function (cmd, args, timeout) {
    var self = this;
    var id = ++this.nextId;
    var req = Object.assign({ id: id, cmd: cmd }, args || {});
    var text = '#GL ' + JSON.stringify(req) + '\n';
    return new Promise(function (resolve, reject) {
      var entry = { resolve: resolve, reject: reject, timer: null };
      self.pending.set(id, entry);
      self.write(text).then(function () {
        if (!self.pending.has(id)) return;
        entry.timer = setTimeout(function () {
          self.pending.delete(id);
          var e = new Error('No answer from the node');
          e.timeout = true;
          reject(e);
        }, timeout || 3000);
      }, function (err) {
        self.pending.delete(id);
        reject(err);
      });
    });
  };

  Link.prototype.failAll = function (err) {
    this.pending.forEach(function (p) { clearTimeout(p.timer); p.reject(err); });
    this.pending.clear();
  };

  Link.prototype.close = async function () {
    this.closing = true;
    this.failAll(new Error('Disconnected'));
    try { if (this.reader) await this.reader.cancel(); } catch (e) { /* gone */ }
    try { await this.loop; } catch (e) { /* ended */ }
    try { await this.wq; } catch (e) { /* ended */ }
    try { await this.port.close(); } catch (e) { /* already closed */ }
  };

  // ===================================================================
  // Setup state
  // ===================================================================

  var S = {
    link: null,
    portInfo: null,     // USB ids of the chosen port, to find it again after a reset
    info: null,
    config: null,
    waiting: false,     // the port went away; reattach when it comes back
    busy: false,        // saving: don't redraw the form under the user
    attaching: false
  };

  var connBtn = $('connect-btn');
  var retryBtn = $('retry-btn');
  var discBtn = $('disconnect-btn');

  function setConn(kind, title, text) {
    $('conn-dot').className = 'fl-dot' + (kind ? ' ' + kind : '');
    $('conn-title').textContent = title;
    $('conn-text').innerHTML = text || '';
    var linked = !!S.link;
    connBtn.hidden = linked || S.waiting;
    discBtn.hidden = !linked && !S.waiting;
  }

  // ----- log -----
  var logLines = [];
  var logTimer = null;
  function logLine(line) {
    if (!line.trim()) return;
    logLines.push(line);
    if (logLines.length > 500) logLines.splice(0, logLines.length - 500);
    if (!logTimer) logTimer = setTimeout(drawLog, 120);
  }
  function drawLog() {
    logTimer = null;
    var pre = $('log');
    var atEnd = pre.scrollTop + pre.clientHeight >= pre.scrollHeight - 8;
    pre.textContent = logLines.length ? logLines.join('\n') : 'Nothing received yet.';
    $('log-count').textContent = logLines.length ? '(' + logLines.length + ' lines)' : '';
    if (atEnd) pre.scrollTop = pre.scrollHeight;
  }
  $('log-clear').addEventListener('click', function () { logLines = []; drawLog(); });

  // ----- connect / disconnect -----
  if (!('serial' in navigator)) {
    $('no-serial').hidden = false;
    connBtn.disabled = true;
    setConn('err', 'Not available in this browser', 'USB setup needs Web Serial: Chrome or Edge on a desktop or laptop.');
  }

  connBtn.addEventListener('click', async function () {
    var port;
    try {
      port = await navigator.serial.requestPort();
    } catch (e) {
      return;   // the user closed the port picker
    }
    S.portInfo = port.getInfo();
    attach(port);
  });
  retryBtn.addEventListener('click', function () { retryBtn.hidden = true; handshake(); });
  discBtn.addEventListener('click', function () { disconnect(); });

  async function disconnect() {
    S.waiting = false;
    var l = S.link;
    S.link = null;
    retryBtn.hidden = true;
    if (l) await l.close();
    setConn('', 'Not connected', 'Click Connect to talk to the node again.');
  }

  function samePort(info) {
    return S.portInfo && info &&
      info.usbVendorId === S.portInfo.usbVendorId && info.usbProductId === S.portInfo.usbProductId;
  }

  async function attach(port) {
    if (S.attaching) return;
    S.attaching = true;
    retryBtn.hidden = true;
    try {
      if (S.link) await S.link.close();
      S.link = null;
      setConn('busy', 'Opening the port…', '');
      try {
        await port.open({ baudRate: BAUD, bufferSize: 16384 });
      } catch (e) {
        S.waiting = false;
        setConn('err', 'Can\'t open the port',
          'Another window or program is using it. Close the install window and any serial monitor, then click Connect again.' +
          ' <span class="muted">(' + esc(e.message) + ')</span>');
        return;
      }
      S.waiting = false;
      var link = new Link(port, logLine, lost);
      S.link = link;
      await link.quiet();
      link.start();
    } finally {
      S.attaching = false;
    }
    await handshake();
  }

  // The node restarted (native USB drops off the bus) or was unplugged.
  function lost(link) {
    if (S.link !== link) return;
    S.link = null;
    try { link.port.close(); } catch (e) { /* gone */ }
    S.waiting = true;
    setConn('busy', 'The node went away', 'Waiting for it to come back. If you unplugged it, plug it in again.');
    waitForPort(Date.now() + 40000);
  }

  async function waitForPort(until) {
    while (S.waiting && Date.now() < until) {
      if (!S.attaching) {
        var ports = await navigator.serial.getPorts();
        var p = ports.filter(function (x) { return samePort(x.getInfo()) && !x.readable; })[0];
        if (p) { await attach(p); return; }
      }
      await sleep(700);
    }
    if (S.waiting) {
      S.waiting = false;
      setConn('err', 'Disconnected', 'The node didn\'t come back. Plug it in and click Connect.');
    }
  }
  if ('serial' in navigator) {
    navigator.serial.addEventListener('connect', function (e) {
      if (S.waiting && samePort(e.target.getInfo())) attach(e.target);
    });
  }

  // Ask for "info" until the node answers. A node that was just installed or
  // restarted takes a few seconds before it listens.
  async function handshake() {
    var link = S.link;
    if (!link) return;
    setConn('busy', 'Waiting for the node…', 'A node that has just been installed or restarted takes a few seconds.');
    var until = Date.now() + 20000;
    var info = null;
    while (S.link === link && Date.now() < until) {
      try {
        info = await link.send('info', null, 1500);
        break;
      } catch (e) {
        if (e.fromNode || S.link !== link) break;
      }
    }
    if (S.link !== link) return;
    if (!info) {
      retryBtn.hidden = false;
      setConn('err', 'No answer from the node',
        'Check that this is the node\'s port and that it runs firmware with USB setup (any release from this page). ' +
        'An older firmware or a different program only prints its log; open the serial log below to see what arrives.');
      return;
    }
    S.info = info;
    try {
      S.config = (await link.send('get', null, 4000)).config;
    } catch (e) {
      setConn('err', 'The node didn\'t send its settings', esc(e.message));
      retryBtn.hidden = false;
      return;
    }
    setConn('ok', 'Connected to ' + (S.config.node_info && S.config.node_info.short_name || info.board),
      esc(info.board) + ' · firmware ' + esc(info.firmware_version));
    drawFacts();
    if (!S.busy) drawForm();
    $('node').hidden = false;
  }

  // ===================================================================
  // Node summary
  // ===================================================================

  function netSummary(info) {
    var n = info.network || {};
    var w = n.wifi || {};
    var parts = [];
    if (n.primary === 'ethernet') parts.push('Ethernet · ' + esc(n.ip_address));
    else if (n.primary === 'wifi') parts.push('Wi-Fi “' + esc(w.ssid) + '” · ' + esc(n.ip_address));
    if (n.ap && n.ap.active) parts.push('own network “' + esc(n.ap.ssid) + '” · ' + esc(n.ap.ip));
    if (!parts.length) {
      if (w.state === 'connecting' || w.state === 'getting_ip') parts.push('joining “' + esc(w.ssid) + '”…');
      else parts.push('not connected');
    }
    if (n.primary !== 'wifi' && (w.state === 'failed' || w.state === 'off') && w.reason && w.reason_text) {
      parts.push('Wi-Fi failed: ' + esc(w.reason_text));
    }
    return parts.join('<br>');
  }

  function webLinks(info) {
    var n = info.network || {};
    var out = [];
    var ip = n.ip_address || (n.ap && n.ap.active && n.ap.ip);
    if (ip) out.push('http://' + ip + '/');
    if (n.hostname && info.features && info.features.mdns && n.primary !== 'none' && n.primary !== 'ap') {
      out.push('http://' + n.hostname + '.local/');
    }
    return out;
  }

  function drawFacts() {
    var i = S.info;
    var links = webLinks(i).map(function (u) { return '<a href="' + esc(u) + '" target="_blank" rel="noopener">' + esc(u) + '</a>'; });
    var rows = [
      ['Board', esc(i.board) + ' <span class="muted">(' + esc(i.chip) + ')</span>'],
      ['Firmware', esc(i.firmware_version) + (i.tester && i.tester.enabled ? ' · <span class="badge proto">DMX tester</span>' : '')],
      ['Network', netSummary(i)],
      ['Web UI', links.length ? links.join('<br>') : '<span class="muted">once it is on a network</span>'],
      ['MAC address', '<code>' + esc(i.mac) + '</code>']
    ];
    $('facts').innerHTML = rows.map(function (r) { return '<div><dt>' + r[0] + '</dt><dd>' + r[1] + '</dd></div>'; }).join('');
  }

  // ===================================================================
  // Form
  // ===================================================================

  var PORT_MODES = [[0, 'Off'], [1, 'DMX output'], [2, 'DMX input']];
  var RDM_MODES = [[3, 'RDM controller'], [4, 'RDM responder']];
  var PROTOCOLS = [[0, 'Art-Net only'], [1, 'sACN only'], [2, 'Both, Art-Net wins'], [3, 'Both, sACN wins'], [4, 'Both, merged']];

  function options(list, sel) {
    return list.map(function (o) {
      return '<option value="' + o[0] + '"' + (o[0] === sel ? ' selected' : '') + '>' + esc(o[1]) + '</option>';
    }).join('');
  }
  function has(f) { return !!(S.info && S.info.features && S.info.features[f]); }
  function profiles() { return (S.config.network && S.config.network.wifi_profiles) || []; }
  function firstSetup() { return S.info && !S.info.password_set; }

  function modeList() {
    var l = [];
    l.push([0, has('ethernet') ? 'Automatic: Ethernet, else Wi-Fi, else its own network' : 'Automatic: Wi-Fi, else its own network']);
    if (has('ethernet')) l.push([1, 'Ethernet only']);
    l.push([2, 'Wi-Fi only']);
    l.push([3, 'Own network only (access point)']);
    return l;
  }
  var MODE_HELP = {
    0: 'Uses the first connection that works and keeps checking for a better one.',
    1: 'Wi-Fi stays off. The node opens its own network only while Ethernet is unplugged.',
    2: 'Ethernet stays off. The node opens its own network while it can\'t join Wi-Fi.',
    3: 'The node doesn\'t join a network. Connect to its own network to reach it.'
  };

  function drawForm() {
    var c = S.config;
    var ni = c.node_info || {};
    var net = c.network || {};
    $('f-short').value = ni.short_name || '';
    $('f-long').value = ni.long_name || '';

    $('f-pw').value = $('f-pw2').value = '';
    $('pw-help').textContent = firstSetup()
      ? 'This node has no admin password yet. Choose one (8 to 63 characters); you\'ll sign in to the web UI with it.'
      : 'Leave empty to keep the current password. Typing a new one replaces it, also when the old one is forgotten.';

    $('f-mode').innerHTML = options(modeList(), net.mode || 0);
    if (!modeList().some(function (m) { return m[0] === net.mode; })) $('f-mode').value = '0';

    var p = profiles()[0];
    $('f-ssid').value = p ? p.ssid : '';
    $('f-wpw').value = '';
    $('scan-box').hidden = true;
    ssidChanged();

    $('f-apssid').value = net.ap_ssid || '';
    $('f-appw').value = '';
    $('appw-help').textContent = firstSetup()
      ? 'Change it from the default 12345678: 8 to 63 characters.'
      : 'Leave empty to keep the current password.';

    var ports = S.info.ports || 0;
    var html = '';
    for (var n = 1; n <= ports; n++) {
      var pc = c['port' + n] || {};
      var modes = PORT_MODES.concat(has('rdm') ? RDM_MODES : []);
      html += '<div class="port" data-port="' + n + '">' +
        '<div class="port-n">Port ' + n + '</div>' +
        '<div class="field"><label for="p' + n + '-mode">Mode</label><select id="p' + n + '-mode" data-k="mode">' + options(modes, pc.mode != null ? pc.mode : 1) + '</select></div>' +
        '<div class="field"><label for="p' + n + '-uni">Art-Net Port-Address</label><input type="number" id="p' + n + '-uni" data-k="universe_primary" min="0" max="32767" value="' + (pc.universe_primary != null ? pc.universe_primary : n - 1) + '"><small data-nsu></small></div>' +
        (has('sacn')
          ? '<div class="field"><label for="p' + n + '-sacn">sACN universe</label><input type="number" id="p' + n + '-sacn" data-k="sacn_universe" min="1" max="63999" value="' + (pc.sacn_universe != null ? pc.sacn_universe : n) + '"></div>' +
            '<div class="field"><label for="p' + n + '-proto">Protocol</label><select id="p' + n + '-proto" data-k="protocol_mode">' + options(PROTOCOLS, pc.protocol_mode != null ? pc.protocol_mode : 4) + '</select></div>'
          : '') +
        '</div>';
    }
    $('ports').innerHTML = html || '<p class="muted small">This board has no DMX ports.</p>';
    document.querySelectorAll('#ports [data-k="universe_primary"]').forEach(function (inp) {
      inp.addEventListener('input', function () { showNsu(inp); });
      showNsu(inp);
    });

    $('tester-box').hidden = !has('tester');
    $('f-tester').checked = !!(c.tester && c.tester.enabled);

    modeChanged();
    clearErrors();
  }

  function showNsu(inp) {
    var v = parseInt(inp.value, 10);
    var out = inp.parentNode.querySelector('[data-nsu]');
    if (!out) return;
    out.textContent = v >= 0 && v <= 32767
      ? 'Net ' + ((v >> 8) & 0x7f) + ' · Sub ' + ((v >> 4) & 0xf) + ' · Uni ' + (v & 0xf)
      : '0 to 32767';
  }

  function modeChanged() {
    var m = parseInt($('f-mode').value, 10);
    $('mode-help').textContent = MODE_HELP[m] || '';
    var wifiOff = m === 1 || m === 3;
    ['f-ssid', 'f-wpw', 'scan-btn'].forEach(function (id) { $(id).disabled = wifiOff; });
    if (wifiOff) $('scan-box').hidden = true;
  }
  $('f-mode').addEventListener('change', modeChanged);

  function ssidChanged() {
    var ssid = $('f-ssid').value;
    var saved = profiles().filter(function (p) { return p.ssid === ssid; })[0];
    var others = profiles().filter(function (p) { return p.ssid !== ssid; }).map(function (p) { return '“' + p.ssid + '”'; });
    var help = '';
    if (saved) help = 'Saved on the node' + (saved.has_password ? ', with its password' : '') + '. ';
    if (others.length) help += 'Also saved: ' + others.join(', ') + '. This one is tried first.';
    else if (!ssid) help = 'Leave empty to keep the saved networks as they are.';
    $('ssid-help').textContent = help.trim();
    $('wpw-help').textContent = saved && saved.has_password
      ? 'Leave empty to keep the saved password.'
      : 'Leave empty for an open network.';
  }
  $('f-ssid').addEventListener('input', ssidChanged);

  // ----- Wi-Fi scan -----
  $('scan-btn').addEventListener('click', async function () {
    if (!S.link) return;
    var btn = $('scan-btn');
    btn.disabled = true;
    btn.textContent = 'Scanning…';
    var list = $('scan-list');
    $('scan-box').hidden = false;
    list.innerHTML = '<li class="muted small">Looking for networks…</li>';
    try {
      var r = await S.link.send('scan', null, 15000);
      var nets = (r.networks || []).slice().sort(function (a, b) { return b.rssi - a.rssi; });
      if (!nets.length) {
        list.innerHTML = '<li class="muted small">No networks found. The node only sees 2.4 GHz Wi-Fi.</li>';
      } else {
        list.innerHTML = nets.map(function (n, i) {
          var lvl = n.rssi >= -55 ? 4 : n.rssi >= -67 ? 3 : n.rssi >= -78 ? 2 : 1;
          var bars = '<span class="bars" aria-hidden="true">' + [1, 2, 3, 4].map(function (b) {
            return '<i class="' + (b <= lvl ? 'on' : '') + '" style="height:' + (b * 3) + 'px"></i>';
          }).join('') + '</span>';
          var kind = n.enterprise ? 'Enterprise, not supported' : n.secure ? 'Password' : 'Open';
          var saved = profiles().some(function (p) { return p.ssid === n.ssid; }) ? ' · saved' : '';
          return '<li><button type="button" data-i="' + i + '"' + (n.enterprise ? ' disabled' : '') + '>' + bars +
            '<span class="ssid">' + esc(n.ssid) + '</span><span class="meta">' + kind + saved + ' · ' + n.rssi + ' dBm · ch ' + n.channel + '</span></button></li>';
        }).join('');
        list.querySelectorAll('button[data-i]').forEach(function (b) {
          b.addEventListener('click', function () {
            var n = nets[+b.getAttribute('data-i')];
            $('f-ssid').value = n.ssid;
            ssidChanged();
            $('scan-box').hidden = true;
            if (n.secure) $('f-wpw').focus();
          });
        });
      }
    } catch (e) {
      list.innerHTML = '<li class="muted small">Scan failed: ' + esc(e.message) + '</li>';
    } finally {
      btn.textContent = 'Scan';
      modeChanged();
    }
  });

  // ----- validation -----
  function clearErrors() {
    document.querySelectorAll('#setup-form .field.bad').forEach(function (f) { f.classList.remove('bad'); });
    document.querySelectorAll('#setup-form small.err').forEach(function (s) { s.remove(); });
  }
  function bad(id, msg) {
    var f = $(id).closest('.field');
    f.classList.add('bad');
    var s = document.createElement('small');
    s.className = 'err';
    s.textContent = msg;
    f.appendChild(s);
    return id;
  }

  function collect() {
    clearErrors();
    var errs = [];
    var c = S.config;
    var doc = {};
    var v;

    // Name
    var ni = c.node_info || {};
    var sn = $('f-short').value.trim();
    var ln = $('f-long').value.trim();
    if (!sn) errs.push(bad('f-short', 'Give the node a short name.'));
    else if (utf8len(sn) > 17) errs.push(bad('f-short', 'At most 17 characters.'));
    if (utf8len(ln) > 63) errs.push(bad('f-long', 'At most 63 characters.'));
    if (sn !== (ni.short_name || '') || ln !== (ni.long_name || '')) {
      doc.node_info = { short_name: sn, long_name: ln };
    }

    // Admin password
    var pw = $('f-pw').value;
    if (pw || $('f-pw2').value || firstSetup()) {
      if (pw.length < 8 || pw.length > 63) errs.push(bad('f-pw', firstSetup() ? 'Required: 8 to 63 characters.' : '8 to 63 characters.'));
      else if (pw !== $('f-pw2').value) errs.push(bad('f-pw2', 'The two passwords differ.'));
    }

    // Network
    var oldNet = c.network || {};
    var net = {};
    var mode = parseInt($('f-mode').value, 10);
    if (mode !== (oldNet.mode || 0)) net.mode = mode;

    var ssid = $('f-ssid').value;
    var wpw = $('f-wpw').value;
    var wifiOn = mode === 0 || mode === 2;
    if (wifiOn && ssid) {
      if (utf8len(ssid) > 32) errs.push(bad('f-ssid', 'At most 32 bytes.'));
      if (wpw && (wpw.length < 8 || wpw.length > 64)) errs.push(bad('f-wpw', 'Wi-Fi passwords are 8 to 63 characters (or 64 hex digits).'));
      var list = profiles();
      var first = list[0];
      if (!first || first.ssid !== ssid || wpw) {
        var keep = list.filter(function (p) { return p.ssid !== ssid; });
        var mine = list.filter(function (p) { return p.ssid === ssid; })[0] || { ssid: ssid };
        var entry = {
          ssid: ssid,
          use_static_ip: !!mine.use_static_ip,
          static_ip: mine.static_ip || '',
          gateway: mine.gateway || '',
          netmask: mine.netmask || ''
        };
        if (wpw) entry.password = wpw;   // left out: the node keeps the saved one
        net.wifi_profiles = [entry].concat(keep.map(function (p) {
          return { ssid: p.ssid, use_static_ip: !!p.use_static_ip, static_ip: p.static_ip || '', gateway: p.gateway || '', netmask: p.netmask || '' };
        })).slice(0, 5).map(function (p, i) { p.priority = i; return p; });
      }
    } else if (mode === 2 && !ssid && !profiles().length) {
      errs.push(bad('f-ssid', 'Wi-Fi only needs a network to join.'));
    }

    var apssid = $('f-apssid').value.trim();
    if (!apssid) errs.push(bad('f-apssid', 'Give the network a name.'));
    else if (utf8len(apssid) > 31) errs.push(bad('f-apssid', 'At most 31 bytes.'));
    else if (apssid !== (oldNet.ap_ssid || '')) net.ap_ssid = apssid;
    var appw = $('f-appw').value;
    if (appw || firstSetup()) {
      if (appw.length < 8 || appw.length > 63) errs.push(bad('f-appw', firstSetup() ? 'Required: 8 to 63 characters.' : '8 to 63 characters.'));
      else if (appw === '12345678') errs.push(bad('f-appw', 'Pick something other than the default.'));
      else net.ap_password = appw;
    }
    if (Object.keys(net).length) doc.network = net;

    // Ports
    document.querySelectorAll('#ports .port').forEach(function (row) {
      var n = row.getAttribute('data-port');
      var old = c['port' + n] || {};
      var pc = {};
      row.querySelectorAll('[data-k]').forEach(function (el) {
        var k = el.getAttribute('data-k');
        v = parseInt(el.value, 10);
        var min = el.min !== '' ? +el.min : -Infinity;
        var max = el.max !== '' ? +el.max : Infinity;
        if (isNaN(v) || v < min || v > max) { errs.push(bad(el.id, min + ' to ' + max + '.')); return; }
        if (v !== old[k]) pc[k] = v;
      });
      if (Object.keys(pc).length) doc['port' + n] = pc;
    });

    // Tester
    if (has('tester')) {
      var t = $('f-tester').checked;
      if (t !== !!(c.tester && c.tester.enabled)) doc.tester = { enabled: t };
    }

    return { errs: errs, doc: doc, password: pw || null, ssid: wifiOn && ssid ? ssid : null, mode: mode };
  }

  // ----- saving -----
  function progress(text) {
    var li = document.createElement('li');
    li.className = 'busy';
    li.textContent = text;
    $('progress').appendChild(li);
    return {
      done: function (t) { li.className = 'done'; if (t) li.textContent = t; },
      fail: function (t) { li.className = 'fail'; if (t) li.textContent = t; },
      text: function (t) { li.textContent = t; }
    };
  }

  function setFormDisabled(off) {
    document.querySelectorAll('#setup-form input, #setup-form select, #setup-form button').forEach(function (el) { el.disabled = off; });
    if (!off) modeChanged();
  }

  async function infoNow(ms) {
    var until = Date.now() + ms;
    while (Date.now() < until) {
      if (S.link && !S.attaching) {
        try { return await S.link.send('info', null, 1500); } catch (e) { /* not back yet */ }
      } else {
        await sleep(500);
      }
    }
    return null;
  }

  $('setup-form').addEventListener('submit', async function (ev) {
    ev.preventDefault();
    if (!S.link || S.busy) return;
    var r = collect();
    if (r.errs.length) {
      $(r.errs[0]).focus();
      return;
    }
    if (!Object.keys(r.doc).length && !r.password) {
      $('save-note').textContent = 'Nothing changed.';
      return;
    }
    $('save-note').textContent = 'Only what you change here is sent.';

    S.busy = true;
    setFormDisabled(true);
    $('result').hidden = false;
    $('result-title').textContent = 'Saving';
    $('progress').innerHTML = '';
    $('done-links').innerHTML = '';
    $('result').scrollIntoView({ behavior: 'smooth', block: 'nearest' });

    var ok = true;
    var restart = false;
    try {
      if (Object.keys(r.doc).length) {
        var st = progress('Saving the settings');
        try {
          var res = await S.link.send('set', { config: r.doc }, 10000);
          restart = !!res.restart_needed;
          st.done('Settings saved');
        } catch (e) {
          st.fail('Settings not saved: ' + e.message);
          throw e;
        }
      }
      if (r.password) {
        var sp = progress('Setting the admin password');
        try {
          await S.link.send('password', { password: r.password }, 8000);
          sp.done('Admin password set');
          S.info.password_set = true;
        } catch (e) {
          sp.fail('Admin password not set: ' + e.message);
          throw e;
        }
      }
      if (r.ssid && r.doc.network && r.doc.network.wifi_profiles && !restart) {
        try { await S.link.send('connect', { ssid: r.ssid }, 3000); } catch (e) { /* it connects on its own */ }
      }
      if (restart) {
        var sr = progress('Restarting the node');
        try { await S.link.send('restart', null, 3000); } catch (e) { /* it may go before it answers */ }
        await sleep(1500);
        var back = await infoNow(30000);
        if (!back) { sr.fail('The node didn\'t come back after restarting. Check the serial log.'); throw new Error('no restart'); }
        S.info = back;
        sr.done('Restarted');
      }
      if (!(await watchNetwork(r))) ok = false;
    } catch (e) {
      ok = false;
    }

    // Read back what the node now has.
    try {
      if (S.link) {
        S.info = (await S.link.send('info', null, 3000)) || S.info;
        S.config = (await S.link.send('get', null, 4000)).config;
      }
    } catch (e) { /* keep the old copy */ }
    S.busy = false;
    setFormDisabled(false);
    if (S.config) drawForm();
    if (S.info) drawFacts();
    $('result-title').textContent = ok ? 'Done' : 'Not finished';
    if (S.link && S.config && S.info) {
      setConn('ok', 'Connected to ' + ((S.config.node_info && S.config.node_info.short_name) || S.info.board),
        esc(S.info.board) + ' · firmware ' + esc(S.info.firmware_version));
    }
    var links = S.info ? webLinks(S.info) : [];
    $('done-links').innerHTML = links.map(function (u, i) {
      return '<a class="btn small' + (i === 0 ? ' primary' : '') + '" href="' + esc(u) + '" target="_blank" rel="noopener">Open ' + esc(u) + '</a>';
    }).join('');
  });

  // After saving: follow the node until it is on the network it was given.
  async function watchNetwork(r) {
    if (!r.doc.network) return true;
    var sw = progress('Waiting for the network');
    var until = Date.now() + 45000;
    var info = null;
    var failedSince = 0;
    var tried = false;   // seen an attempt start, so a reason is about this network
    var started = Date.now();
    while (Date.now() < until) {
      info = await infoNow(3000);
      if (info) {
        S.info = info;
        drawFacts();
        var n = info.network || {};
        var w = n.wifi || {};
        if (r.mode === 3) {
          if (n.ap && n.ap.active) { sw.done('Own network “' + n.ap.ssid + '” is up at ' + n.ap.ip); return true; }
        } else if (r.ssid) {
          if (w.state === 'connected' && w.ssid === r.ssid) { sw.done('Joined “' + w.ssid + '”: ' + (w.ip || n.ip_address)); return true; }
          if (n.primary === 'ethernet' && r.mode === 0) { sw.done('On Ethernet: ' + n.ip_address + ' (Wi-Fi is used when the cable is out)'); return true; }
          var why = w.reason_text ? ': ' + w.reason_text : '';
          if (w.state === 'connecting' || w.state === 'getting_ip') tried = true;
          if (w.state === 'off' && w.reason && (tried || Date.now() - started > 10000)) {
            // The node gave up on this network for now (it tries again later).
            sw.fail('Couldn\'t join “' + r.ssid + '”' + why + '. Check the name and password, then save again.');
            return false;
          }
          if (w.state === 'failed') {
            // Between retries within one attempt
            failedSince = failedSince || Date.now();
            sw.text('Joining “' + r.ssid + '” failed' + why + '. Retrying…');
            if (Date.now() - failedSince > 15000) {
              sw.fail('Couldn\'t join “' + r.ssid + '”' + why + '. Check the name and password, then save again.');
              return false;
            }
          } else {
            failedSince = 0;
            sw.text('Joining “' + r.ssid + '”…' + (w.state === 'getting_ip' ? ' getting an address' : ''));
          }
        } else if (n.primary && n.primary !== 'none') {
          sw.done('On the network: ' + (n.ip_address || ''));
          return true;
        }
      }
      await sleep(1500);
    }
    sw.fail('Still not on the network after 45 seconds. The node keeps trying; the summary above updates when you reconnect.');
    return false;
  }
})();
