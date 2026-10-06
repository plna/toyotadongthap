/* OnePanel browser-signal collector.
 * Same-origin, external, and byte-constant.
 * Token read from tag data-osh-ct or fetched from /_osh/ct.
 * Ordinary injected pages also carry a server-owned page RID in a preceding meta element.
 * Two emissions, not one:
 *   ready   -- once after load, target within ~1 s. Coarse browser-consistency fields and
 *              explicit capability/missing states only. No behavioural data, no PoW: those are
 *              not known yet this early.
 *   summary -- exactly once, at the earliest of SUMMARY_DWELL_MS / pagehide / hidden. Bucketed
 *              behaviour, visibility, pointer/scroll and PoW evidence.
 *
 * /_osh/ct answers either shape and both are handled:
 *   v1 (live today):  {"ct": "...", "nonce": "...", "difficulty": N}
 *                      -- one credential. The server accepts one ready and one summary POST per
 *                      token; the phase header selects the server-side one-shot slot.
 *   v2 (minted by /_osh/ct):
 *                      {"pageview_ref": "...", "credentials": {"ready": {...}, "summary": {...}}}
 *                      -- two credentials, each bound to its own phase and originating page RID.
 *                      -- v2 is live; the widget accepts it alongside cached legacy v1 tags.
 */
(function () {
  "use strict";
  // The catch (e) parameter is required: `catch {}` is ES2019, but this file must parse on ES5 engines.
  // A legacy-engine parse failure drops the whole bundle and beacon on every page, not just challenge pages.
  // `e` is intentionally unused: every catch fails open silently; this widget must never break a customer page.
  var self = document.currentScript;
  if (!self) return;
  var pageRequestId = null;
  var pageCapability = null;
  try {
    // The RID belongs to this script only when the injected meta is its immediately preceding
    // element. Never query the document globally: customer markup can carry arbitrary lookalike
    // metadata from another request or application.
    var ridContext = self.previousElementSibling;
    if (!ridContext && self.previousSibling) {
      ridContext = self.previousSibling;
      while (ridContext && ridContext.nodeType === 3 && /^\s*$/.test(ridContext.nodeValue || "")) {
        ridContext = ridContext.previousSibling;
      }
    }
    if (ridContext && typeof ridContext.getAttribute === "function"
        && typeof ridContext.tagName === "string"
        && ridContext.tagName.toLowerCase() === "meta") {
      pageRequestId = ridContext.getAttribute("data-osh-rid");
      pageCapability = ridContext.getAttribute("data-osh-rid-cap");
    }
  } catch (e) {}

  var CSS_PIXELS = [0, 320, 480, 640, 768, 1024, 1280, 1440, 1920, 2560, 3840, 65535];
  var LOGICAL_CPU = [0, 1, 2, 4, 8, 16, 32, 64, 128, 65535];
  var HOUR = [-24, -12, -11, -10, -9, -8, -7, -6, -5, -4, -3, -2, -1, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 24];
  var COUNT_BUCKET = [0, 1, 2, 4, 8, 16, 32, 64, 128, 256, 65535];
  var PERCENT_BUCKET = [0, 10, 25, 50, 75, 90, 100, 65535];
  var MILLISECONDS = [0, 8, 16, 32, 64, 128, 256, 512, 1000, 2000, 4000, 8000, 16000, 30000, 60000, 65535];

  var POW_BUDGET_MS = 400;
  // The summary emission's own earliest-trigger window. 15 s, well inside the 300 s
  // TOKEN_TTL_SECS margin in collect_token.rs, so expiry/clock-skew is not a practical concern at
  // this dwell -- unlike the old single-emission 240 s design, which existed only to leave that
  // margin. Splitting emission means the summary no longer has to wait out most of the page's
  // life to be useful.
  var SUMMARY_DWELL_MS = 15000;
  var MAX_POW_ITERATIONS = 500000;

  function bucketUp(ladder, value) {
    if (typeof value !== "number" || !isFinite(value) || value < 0) return null;
    for (var i = 0; i < ladder.length; i++) {
      if (value <= ladder[i]) return ladder[i];
    }
    return ladder[ladder.length - 1];
  }

  function nearestAllowed(ladder, value) {
    if (typeof value !== "number" || !isFinite(value)) return null;
    return ladder.indexOf(value) === -1 ? null : value;
  }

  function hexToBytes(hex) {
    if (typeof hex !== "string" || hex.length % 2 !== 0) return null;
    var bytes = new Uint8Array(hex.length / 2);
    for (var i = 0; i < hex.length; i += 2) {
      var v = parseInt(hex.substr(i, 2), 16);
      if (isNaN(v)) return null;
      bytes[i / 2] = v;
    }
    return bytes;
  }

  function strToBytes(str) {
    var b = new Uint8Array(str.length);
    for (var i = 0; i < str.length; i++) b[i] = str.charCodeAt(i);
    return b;
  }

  function concat(a, b) {
    var c = new Uint8Array(a.length + b.length);
    c.set(a, 0);
    c.set(b, a.length);
    return c;
  }

  function leadingZeroBits(buf) {
    var bytes = new Uint8Array(buf);
    var bits = 0;
    for (var i = 0; i < bytes.length; i++) {
      var b = bytes[i];
      if (b === 0) { bits += 8; continue; }
      bits += Math.clz32(b) - 24;
      break;
    }
    return bits;
  }

  // Two guards, not one: ready and summary are independent lifecycle stages with independent
  // exactly-once contracts. A late summary trigger (a second `hidden` transition, say) must not
  // resend, and neither emission's guard affects the other's.
  var readySent = false;
  var summarySent = false;

  // Yield to the event loop between batches WITHOUT waiting for the browser to feel idle.
  //
  // This used to be `requestIdleCallback(step, { timeout: 100 })`, and that call is the reason the
  // proof almost never finished. An idle callback runs when the main thread is idle, and during page
  // load it is not — so each batch waited out its 100 ms timeout instead. A few batches and the whole
  // 400 ms budget is gone with barely any hashing done. The fallback branch was no better in kind:
  // browsers clamp a nested `setTimeout(..., 0)` to ~4 ms, which over the hundreds of batches an
  // 18-bit target needs is seconds of pure scheduling.
  //
  // Measured on the fleet 2026-08-19, solve rate among clients that attempted: iOS 79.6% (Safari,
  // which has no `requestIdleCallback` and therefore took the clamped-timeout path), Windows 7.9% and
  // Android 4.4% (Chrome, which has it and took the idle path). An 18x spread on a signal that is
  // supposed to be about automation. Note the two variables are collinear in that data — Safari never
  // has the API and Chrome always does — so this change is what separates them: if the gap closes,
  // scheduling was the cause rather than device speed.
  //
  // `MessageChannel` is the yield with no clamp and no idle requirement: posting to a port queues a
  // macrotask that runs on the next turn, so rendering and input still interleave and the tab stays
  // responsive, but a batch waits microseconds rather than up to 100 ms. Supported everywhere the
  // widget already requires WebCrypto. `setTimeout` remains only as a last resort.
  var yieldThenStep = (function () {
    if (typeof window.MessageChannel === "function") {
      var pending = null;
      var channel = new MessageChannel();
      channel.port1.onmessage = function () {
        var fn = pending;
        pending = null;
        if (fn) fn();
      };
      return function (fn) {
        pending = fn;
        channel.port2.postMessage(0);
      };
    }
    return function (fn) { setTimeout(fn, 0); };
  })();

  function computePoW(nonceHex, difficulty, onDone) {
    try {
      var subtle = window.crypto && window.crypto.subtle;
      if (!subtle || typeof subtle.digest !== "function") {
        onDone(null, null);
        return;
      }
      var nonceBytes = hexToBytes(nonceHex);
      if (!nonceBytes || typeof difficulty !== "number" || difficulty <= 0 || difficulty > 32) {
        onDone(null, null);
        return;
      }
      var startTime = (window.performance && window.performance.now) ? performance.now() : Date.now();
      var counter = 0;
      var batchSize = 128;

      function step() {
        if (summarySent) {
          onDone(null, null);
          return;
        }
        var now = (window.performance && window.performance.now) ? performance.now() : Date.now();
        if (now - startTime >= POW_BUDGET_MS || counter >= MAX_POW_ITERATIONS) {
          onDone(null, Math.max(0, Math.round(now - startTime)), true);
          return;
        }
        var promises = [];
        var candidates = [];
        for (var i = 0; i < batchSize; i++) {
          var cand = (counter++).toString(36);
          candidates.push(cand);
          promises.push(subtle.digest("SHA-256", concat(nonceBytes, strToBytes(cand))));
        }
        Promise.all(promises).then(function (digests) {
          if (summarySent) {
            onDone(null, null);
            return;
          }
          for (var j = 0; j < digests.length; j++) {
            if (leadingZeroBits(digests[j]) >= difficulty) {
              var endTime = (window.performance && window.performance.now) ? performance.now() : Date.now();
              onDone(candidates[j], Math.max(0, Math.round(endTime - startTime)));
              return;
            }
          }
          var cur = (window.performance && window.performance.now) ? performance.now() : Date.now();
          if (cur - startTime >= POW_BUDGET_MS || counter >= MAX_POW_ITERATIONS) {
            onDone(null, Math.max(0, Math.round(cur - startTime)), true);
            return;
          }
          yieldThenStep(step);
        }).catch(function () {
          onDone(null, null);
        });
      }

      // The FIRST batch goes through the same yield, for the same reason: an idle callback here
      // could spend 100 ms of a 400 ms budget before a single hash was computed.
      yieldThenStep(step);
    } catch (e) {
      onDone(null, null);
    }
  }

  // Sent with `ready`: coarse, static, browser-consistency fields plus explicit capability/missing
  // states. Nothing here depends on how the visitor behaves on the page -- everything is knowable
  // the instant the script runs, which is what makes an early, one-shot emission honest.
  var readySignals = {};
  var powSolution = null;
  var powGaveUp = false;
  // 4 = the MessageChannel yield plus the TTL-safe dwell. The number exists so a cohort can identify ITSELF in the stored
  // rows: with two builds live at once, `platform_family` told them apart, but a third build that
  // also sends it needs its own marker or the comparison collapses. `widget_version` is declared as
  // an open integer (0..65535), not an enum, so raising it costs no contract change and no consumer
  // redeploy — checked before making the change, because an unknown enum value is rejected per-event
  // and silently.
  //
  //   1  pre-PoW collector
  //   2  inline PoW, 18 then 15 bits, yielding through requestIdleCallback
  //   3  same, yielding through MessageChannel
  //   4  same, waiting for the TTL-safe dwell before sending
  //   5  split into a `ready` emission (~1 s after load) and a `summary` emission (15 s /
  //      pagehide / hidden, whichever is earliest) -- what used to be one POST per pageview is
  //      now up to two, and a reader joining rows by pageview must expect that shape
  //
  // Raise it whenever a change alters what the numbers MEAN, not on every edit: a version nobody can
  // map to a behaviour is worse than no version.
  readySignals.widget_version = 5;

  // Declared in the contract since v1 and never sent by any widget, so `platform_family` read unset
  // on every stored row and the "is a failed proof just an old browser" check had nothing to group
  // by. Both are coarse by construction: eight platform families and one boolean add no identifying
  // entropy beyond what the User-Agent already states.
  try {
    readySignals.idle_callback_available = typeof window.requestIdleCallback === "function";
  } catch (e) {}
  try {
    var uaData = navigator.userAgentData;
    var plat = (uaData && typeof uaData.platform === "string" && uaData.platform) ||
      (typeof navigator.platform === "string" ? navigator.platform : "");
    var ua = typeof navigator.userAgent === "string" ? navigator.userAgent : "";
    var hay = (plat + " " + ua).toLowerCase();
    var family = "unknown";
    if (hay.indexOf("cros") !== -1) family = "chromeos";
    else if (hay.indexOf("android") !== -1) family = "android";
    // iPadOS reports itself as a Mac, so the touch-point count is what separates them.
    else if (hay.indexOf("iphone") !== -1 || hay.indexOf("ipad") !== -1 || hay.indexOf("ipod") !== -1) family = "ios";
    else if (hay.indexOf("mac") !== -1) {
      family = (navigator.maxTouchPoints && navigator.maxTouchPoints > 1) ? "ios" : "macos";
    } else if (hay.indexOf("win") !== -1) family = "windows";
    else if (hay.indexOf("linux") !== -1 || hay.indexOf("x11") !== -1) family = "linux";
    else if (hay !== "") family = "other";
    readySignals.platform_family = family;
  } catch (e) {}

  try {
    var width = window.screen && window.screen.width;
    var w = bucketUp(CSS_PIXELS, width);
    if (w !== null) readySignals.screen_width_bucket = w;
  } catch (e) {}

  try {
    var hc = bucketUp(LOGICAL_CPU, navigator.hardwareConcurrency);
    if (hc !== null) readySignals.hardware_concurrency_bucket = hc;
  } catch (e) {}

  try {
    var offset = new Date().getTimezoneOffset();
    if (typeof offset === "number" && isFinite(offset)) {
      var hours = nearestAllowed(HOUR, Math.round(-offset / 60));
      if (hours !== null) readySignals.timezone_offset_bucket = hours;
    }
  } catch (e) {}

  // Sent with `summary`: bucketed behaviour accumulated over the page's life, plus PoW evidence.
  // Populated at send time by `collectBehavioral()` and by the PoW callback -- never before,
  // because both depend on how long the page has been open.
  var summarySignals = {};

  var pointerEvents = 0;
  var maxScrollPercent = 0;
  var visibilityChanges = 0;

  try {
    var onPointer = function () { pointerEvents++; };
    window.addEventListener("pointerdown", onPointer, { passive: true });
    window.addEventListener("touchstart", onPointer, { passive: true });
    window.addEventListener("mousemove", onPointer, { passive: true });
  } catch (e) {}

  try {
    var onScroll = function () {
      var docEl = document.documentElement || document.body;
      if (!docEl) return;
      var total = docEl.scrollHeight - docEl.clientHeight;
      if (total > 0) {
        var pct = Math.round(((window.scrollY || docEl.scrollTop || 0) / total) * 100);
        if (pct > maxScrollPercent) maxScrollPercent = pct;
      }
    };
    window.addEventListener("scroll", onScroll, { passive: true });
  } catch (e) {}

  try {
    var onVis = function () {
      if (document.hidden) visibilityChanges++;
    };
    document.addEventListener("visibilitychange", onVis, { passive: true });
  } catch (e) {}

  function collectBehavioral() {
    var p = bucketUp(COUNT_BUCKET, pointerEvents);
    if (p !== null) summarySignals.pointer_event_count_bucket = p;

    var s = bucketUp(PERCENT_BUCKET, maxScrollPercent);
    if (s !== null) summarySignals.scroll_depth_bucket = s;

    var v = bucketUp(COUNT_BUCKET, visibilityChanges);
    if (v !== null) summarySignals.visibility_change_count_bucket = v;
  }

  function send(token, payload, phase) {
    if (!token) return;
    var keys = Object.keys(payload);
    if (keys.length === 0) return;
    try {
      var headers = {
        "Content-Type": "application/json",
        "X-Osh-Ct": token,
        "X-Osh-Collection-Phase": phase
      };
      if (pageRequestId && pageCapability) {
        headers["X-Osh-Page-Rid"] = pageRequestId;
        headers["X-Osh-Page-Cap"] = pageCapability;
      }
      fetch("/_osh/collect", {
        method: "POST",
        headers: headers,
        body: JSON.stringify(payload),
        credentials: "same-origin",
        keepalive: true
      }).catch(function () {});
    } catch (e) {}
  }

  // `ready`: fires as soon as a credential is available -- synchronously for the data-osh-ct
  // path, or on the /_osh/ct promise's resolution otherwise. There is no dwell and no PoW gate,
  // which is what keeps it inside the ~1 s target: readySignals is fully populated before this
  // function can even be called.
  function sendReady(cred) {
    if (readySent) return;
    readySent = true;
    send(cred && cred.ct, readySignals, "ready");
  }

  // `summary`: exactly once, guarded the same way `ready` is, at the earliest of the dwell timer,
  // `pagehide`, or hidden visibility.
  function sendSummary(cred) {
    if (!cred) return;
    collectBehavioral();
    if (powSolution !== null) {
      summarySignals.pow = powSolution;
    } else if (powGaveUp) {
      summarySignals.pow = false;
    }
    send(cred.ct, summarySignals, "summary");
  }

  function triggerSummary(cred) {
    if (summarySent) return;
    summarySent = true;
    sendSummary(cred);
  }

  function run(readyCred, summaryCred) {
    sendReady(readyCred);

    var timer = null;
    var onLeave = function () {
      if (timer) clearTimeout(timer);
      triggerSummary(summaryCred);
    };
    try {
      window.addEventListener("pagehide", onLeave, { once: true });
      // The summarySent guard makes this listener one-shot; do not use { once: true }, because a
      // visible transition must not consume it before the first hidden transition can flush.
      document.addEventListener("visibilitychange", function () {
        if (document.visibilityState === "hidden") onLeave();
      });
    } catch (e) {}

    timer = setTimeout(function () { triggerSummary(summaryCred); }, SUMMARY_DWELL_MS);

    var nonce = summaryCred && summaryCred.nonce;
    var difficulty = summaryCred && summaryCred.difficulty;
    if (nonce && typeof difficulty === "number") {
      computePoW(nonce, difficulty, function (solution, elapsedMs, gaveUp) {
        if (solution !== null) {
          powSolution = solution;
        } else if (gaveUp === true) {
          powGaveUp = true;
        }
        // The duration is worth having for a give-up too: it is the difference between hitting the
        // budget wall and bailing out after 8 ms because the tab was hidden, and those call for
        // opposite fixes.
        if ((solution !== null || gaveUp === true) && typeof elapsedMs === "number") {
          var b = bucketUp(MILLISECONDS, elapsedMs);
          if (b !== null) summarySignals.pow_duration_ms_bucket = b;
        }
      });
    }
  }

  // Resolve one or two credentials out of whatever /_osh/ct answered.
  //
  // v2 (two credentials, each phase-bound) is read only if BOTH `credentials.ready` and
  // `credentials.summary` are present -- a partial v2 body is treated as no body at all rather
  // than guessed at. v1 (one credential, no phase binding) is the fallback; the server still
  // enforces one ready and one summary POST per token, selected by the phase header.
  function resolveCredentials(data) {
    if (data && data.credentials && data.credentials.ready && data.credentials.summary) {
      return { ready: data.credentials.ready, summary: data.credentials.summary };
    }
    if (data && typeof data.ct === "string") {
      var v1 = { ct: data.ct, nonce: data.nonce, difficulty: data.difficulty };
      return { ready: v1, summary: v1 };
    }
    return null;
  }
  function resolveTaggedCredentials(encoded) {
    // The challenge tag carries base64url(JSON), not raw JSON: the attribute remains safe in the
    // double-quoted HTML context while the widget still receives the same pair shape as /_osh/ct.
    try {
      if (typeof encoded !== "string" || encoded.length === 0) return null;
      var alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
      var binary = "";
      var buffer = 0;
      var bits = 0;
      for (var i = 0; i < encoded.length; i++) {
        var value = alphabet.indexOf(encoded.charAt(i));
        if (value < 0) return null;
        buffer = (buffer << 6) | value;
        bits += 6;
        if (bits >= 8) {
          bits -= 8;
          binary += String.fromCharCode((buffer >> bits) & 255);
          buffer &= bits === 0 ? 0 : (1 << bits) - 1;
        }
      }
      if (bits >= 6 || (bits !== 0 && buffer !== 0)) return null;
      return resolveCredentials(JSON.parse(binary));
    } catch (e) {
      return null;
    }
  }

  var token = document.currentScript.getAttribute("data-osh-ct");
  if (token) {
    var creds = resolveTaggedCredentials(token);
    if (creds) {
      run(creds.ready, creds.summary);
    } else {
      // Browser-cached pages from before the v2 cutover still carry a raw v1 token. Keep their
      // one-token/two-emission behaviour, and also preserve the no-beacon-loss fallback if a
      // malformed or unsupported tagged payload reaches a client.
      var v1 = { ct: token, nonce: null, difficulty: null };
      run(v1, v1);
    }
  } else {
    try {
      var tokenRequest = { credentials: "same-origin" };
      if (pageRequestId && pageCapability) {
        tokenRequest.headers = {
          "X-Osh-Page-Rid": pageRequestId,
          "X-Osh-Page-Cap": pageCapability
        };
      }
      fetch("/_osh/ct", tokenRequest)
        .then(function (r) {
          return r.status === 200 ? r.json() : null;
        })
        .then(function (data) {
          var creds = resolveCredentials(data);
          if (creds) run(creds.ready, creds.summary);
        })
        .catch(function () {});
    } catch (e) {}
  }
})();
