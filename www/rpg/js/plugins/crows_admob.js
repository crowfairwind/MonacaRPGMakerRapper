//======================================
// crows_admob.js
// bridge版 / standalone / interstitial最小
// - ゲームは止めない（待たない）
// - load/showとも同一cmdの連打抑止（Cooldownのみ）
// - 応答で cmd別ステータス保存
// - inter_ad_show 応答時だけ After共通イベント予約
//======================================
/*:ja
 * @plugindesc (bridge) iframe子(RPGツクールMV)→親(Cordova/Monaca)へpostMessageでAdMob処理を依頼（最小：インタースティシャル）
 *
 * @param bridgeToken
 * @type string
 * @desc 親と子で一致させる認証トークン
 *
 * @param iosInterstitialId
 * @type string
 * @desc iOS用 インタースティシャル広告ユニットID（親側へ送る）
 * @default ca-app-pub-3940256099942544/1033173712
 *
 * @param androidInterstitialId
 * @type string
 * @desc Android用 インタースティシャル広告ユニットID（親側へ送る）
 * @default ca-app-pub-3940256099942544/1033173712
 *
 * @param InterstitialAfterCommonEventID
 * @type number
 * @desc inter_ad_show の応答を受けたら必ず呼ぶコモンイベント番号（成功/失敗は中で get_status して分岐）
 * @default 0
 *
 * @param CooldownMs
 * @type number
 * @desc 同一cmdの連打抑止（ミリ秒）。この時間内は同cmdを再送しない。
 * @default 700
 *
 * @help
 * ■ プラグインコマンド
 *  CrowsAdmob inter_ad_load
 *  CrowsAdmob inter_ad_show
 *
 *  CrowsAdmob get_status <cmd> <varId>
 *   - cmd例: inter_ad_load / inter_ad_show
 *   - varId: 書き込み先変数番号
 *   - 成功=1, 失敗=0, 未取得=-1
 *
 * ■ 運用ルール（重要）
 * - AdMob App ID は MonacaクラウドIDE側で管理する。
 * - 本プラグインから App ID を指定・送信しない。
 * - 本プラグインは広告ユニットIDのみを扱う。
 */

(() => {
    "use strict";

    const P = PluginManager.parameters("crows_admob");

    const TOKEN = String(P["bridgeToken"] || "");
    const AFTER_CE = Number(P["InterstitialAfterCommonEventID"] || 0);
    const COOLDOWN_MS = Math.max(0, Number(P["CooldownMs"] || 700));

    const Bridge = {
      statusMap: Object.create(null),
      lastSentAt: Object.create(null),

      now() {
        return Date.now();
      },

      platformId() {
        try {
          return (window.cordova && cordova.platformId) ? String(cordova.platformId) : "";
        } catch (_) {
          return "";
        }
      },

      adUnitIdForCmd(cmd) {
        const s = String(cmd);
        if (s.startsWith("inter_")) {
          const pid = this.platformId();
          if (pid === "ios") return String(P["iosInterstitialId"] || "");
          if (pid === "android") return String(P["androidInterstitialId"] || "");
        }
        return "";
      },

      storeStatus(cmd, ok) {
        this.statusMap[String(cmd)] = !!ok;
      },

      getStatusValue(cmd) {
        const key = String(cmd);
        if (!(key in this.statusMap)) return -1;
        return this.statusMap[key] ? 1 : 0;
      },

      canSend(cmd) {
        const key = String(cmd);
        const last = Number(this.lastSentAt[key] || 0);
        return (this.now() - last) >= COOLDOWN_MS;
      },

      markSent(cmd) {
        this.lastSentAt[String(cmd)] = this.now();
      },

      send(cmd) {
        cmd = String(cmd);

        if (!this.canSend(cmd)) return;

        const id = this.adUnitIdForCmd(cmd);

        if (!TOKEN || !id) {
          console.log("[crows_admob] missing token or adUnitId -> treat as NG", { cmd, hasToken: !!TOKEN, id });
          this.storeStatus(cmd, false);
          return;
        }

        this.markSent(cmd);
        console.log("[crows_admob] send", { cmd, id });
        window.parent.postMessage({ token: TOKEN, cmd, id }, "*");
      },

      onMessage(ev) {
        const msg = ev.data;
        if (!msg || typeof msg !== "object") return;
        if (msg.token !== TOKEN) return;
        if (typeof msg.cmd !== "string") return;
        if (typeof msg.ok !== "boolean") return;

        const cmd = msg.cmd;
        this.storeStatus(cmd, msg.ok);
        console.log("[crows_admob] recv", { cmd, ok: msg.ok });

        if (cmd === "inter_ad_show" && AFTER_CE > 0) {
          $gameTemp.reserveCommonEvent(AFTER_CE);
        }
      },

      ensureListener() {
        if (this._listenerAdded) return;
        this._listenerAdded = true;
        window.addEventListener("message", this.onMessage.bind(this));
      }
    };

    Bridge.ensureListener();

    // --- プラグインコマンド ---
    const _Game_Interpreter_pluginCommand = Game_Interpreter.prototype.pluginCommand;
    Game_Interpreter.prototype.pluginCommand = function(command, args) {
      _Game_Interpreter_pluginCommand.call(this, command, args);

      if (String(command).toLowerCase() !== "crowsadmob") return;
      const sub = String(args[0] || "").toLowerCase();

      if (sub === "inter_ad_load") {
        Bridge.send("inter_ad_load");

      } else if (sub === "inter_ad_show") {
        Bridge.send("inter_ad_show");

      } else if (sub === "get_status") {
        const cmd = String(args[1] || "");
        const varId = Number(args[2] || 0);
        if (cmd && varId > 0) {
          $gameVariables.setValue(varId, Bridge.getStatusValue(cmd));
        }
      }
    };
  })();
