// www/js/ad_bridge_parent.js
// Monaca/Cordova (admob-plus) 親側ブリッジ【最小版】
// - iframe/ID参照なし（ev.source のみ返信先に使う）
// - 受信したら必ず1回だけ応答を返す（タイムアウト + 二重送信防止）
// - autoshowしない（show cmd が来たときだけ show）
//
// 子->親: { token, cmd, id }
// ※ AdMob App ID は MonacaクラウドIDE側で管理するため、子からは送らない
// 親->子: { token, cmd, ok: boolean }

(() => {
  "use strict";

  // ====== 設定 ======
  const BRIDGE_TOKEN = "REPLACE_WITH_SAME_TOKEN_AS_PLUGIN";

  // タイムアウト（ms）
  const LOAD_TIMEOUT_MS = 12000;
  const SHOW_TIMEOUT_MS = 20000;

  // ====== ユーティリティ ======
  function postToChild(childWin, payload) {
    // ev.source が取れないなら「そもそも成立してない」ので何もしない
    if (!childWin) return;
    try {
      childWin.postMessage(payload, "*");
    } catch (e) {
      console.log("[ad-bridge] postMessage failed:", e);
    }
  }

  function makeResponder(childWin, cmd) {
    let done = false;
    return (ok) => {
      if (done) return;
      done = true;
      postToChild(childWin, { token: BRIDGE_TOKEN, cmd, ok: !!ok });
      console.log("[ad-bridge] send", { cmd, ok: !!ok });
    };
  }

  function withTimeout(promise, ms, onTimeoutValue) {
    let t;
    const timeout = new Promise((resolve) => {
      t = setTimeout(() => resolve(onTimeoutValue), ms);
    });
    return Promise.race([
      promise.finally(() => clearTimeout(t)),
      timeout,
    ]);
  }

  // ====== Interstitial管理（最小） ======
  const Inter = {
    ad: null,
    adUnitId: "",
    loaded: false,
    loading: false,

    ensure(adUnitId) {
      if (!this.ad || this.adUnitId !== adUnitId) {
        this.adUnitId = adUnitId;
        this.ad = new admob.InterstitialAd({ adUnitId });
        this.loaded = false;
        this.loading = false;
      }
      return this.ad;
    },

    async load(adUnitId) {
      if (!adUnitId) return false;

      const ad = this.ensure(adUnitId);

      if (this.loaded) return true;

      // すでにロード中なら完了を待つ（タイムアウトでfalse）
      if (this.loading) {
        return await withTimeout(
          (async () => {
            while (this.loading) await new Promise((r) => setTimeout(r, 80));
            return this.loaded;
          })(),
          LOAD_TIMEOUT_MS,
          false
        );
      }

      this.loading = true;

      const ok = await withTimeout(
        (async () => {
          try {
            await ad.load();
            this.loaded = true;
            return true;
          } catch (e) {
            console.log("[ad-bridge] inter load failed:", e);
            this.loaded = false;
            return false;
          } finally {
            this.loading = false;
          }
        })(),
        LOAD_TIMEOUT_MS,
        false
      );

      if (!ok) {
        this.loading = false;
        this.loaded = false;
      }
      return ok;
    },

    async show() {
      // showは「ロード済みのものを出すだけ」
      if (!this.ad || !this.loaded) return false;

      const ok = await withTimeout(
        (async () => {
          try {
            await this.ad.show();
            return true;
          } catch (e) {
            console.log("[ad-bridge] inter show failed:", e);
            return false;
          } finally {
            // show 試行後は使い捨て運用
            this.loaded = false;
          }
        })(),
        SHOW_TIMEOUT_MS,
        false
      );

      if (!ok) this.loaded = false;
      return ok;
    },
  };

  // ====== メッセージ処理 ======
  async function handleMessage(ev) {
    const msg = ev.data;
    if (!msg || typeof msg !== "object") return;
    if (msg.token !== BRIDGE_TOKEN) return;
    if (typeof msg.cmd !== "string") return;

    const cmd = msg.cmd;
    const adUnitId = String(msg.id || "");
    console.log("[ad-bridge] recv", { cmd, id: adUnitId });

    // 返信先は ev.source のみ
    const childWin = ev.source;

    // 必ず応答するため responder を先に作る
    const respond = makeResponder(childWin, cmd);

    // 応答漏れ最終保険（正常系は二重送信防止で無視される）
    const guardTimeoutMs = Math.max(LOAD_TIMEOUT_MS, SHOW_TIMEOUT_MS) + 500;
    setTimeout(() => respond(false), guardTimeoutMs);

    try {
      if (cmd === "inter_ad_load") {
        const ok = await Inter.load(adUnitId);
        console.log("[ad-bridge] result", { cmd, id: adUnitId, ok });
        return respond(ok);
      }

      if (cmd === "inter_ad_show") {
        // 未ロードなら即 false（勝手にload→showしない）
        if (!Inter.loaded) return respond(false);

        const ok = await Inter.show();
        console.log("[ad-bridge] result", { cmd, id: adUnitId, ok });
        return respond(ok);
      }

      console.log("[ad-bridge] unknown cmd:", cmd);
      return respond(false);

    } catch (e) {
      console.log("[ad-bridge] handler error:", e);
      return respond(false);
    }
  }

  // ====== 初期化 ======
  document.addEventListener("deviceready", async () => {
    console.log("[ad-bridge] deviceready");

    // admob.start() が必要なら呼ぶ（無ければ無視）
    try {
      if (window.admob && typeof admob.start === "function") {
        await admob.start();
      }
    } catch (e) {
      console.log("[ad-bridge] admob.start failed:", e);
    }

    window.addEventListener("message", handleMessage);
  }, false);
})();
