/*
 * fs-i18n.js
 * SOURCE: translation modules 68990 (en) and 15206 (th) in chunk 15mzxjxw7n9~w.js.
 * Keys stick/modal/common/toast are copied verbatim from the original.
 * The `motion` block is NEW (mobile shake extension) and does not exist in the original.
 */
(function (global) {
  'use strict';
  global.FS_I18N = {
    en: {
      stick: {
        holdShake: 'Press & hold button or shake the cylinder!',
        holdButton: 'Hold to Shake',
        shakingButton: 'Shaking...'
      },
      modal: {
        congrats: 'Congratulations!',
        removeWinner: 'Remove Winner',
        removeAllWinner: 'Remove all instances'
      },
      common: { close: 'Close', undo: 'Undo' },
      toast: { winnerRemoved: 'Winner removed' },
      // NEW (not from the original source): mobile shake feature
      motion: {
        enable: 'Shake phone', requesting: '...', on: 'Shake phone: ON',
        hint: 'Shake your phone to shake the cylinder!',
        denied: 'Motion access was not allowed \u2014 press & hold or swipe to shake instead',
        unavailable: 'No motion sensor available \u2014 press & hold or swipe to shake instead',
        fallback: 'Press & hold or swipe to shake instead'
      }
    },
    th: {
      stick: {
        holdShake: 'กดปุ่มค้างไว้ หรือเขย่ากระบอกเซียมซี!',
        holdButton: 'กดค้างเพื่อเขย่า',
        shakingButton: 'กำลังเขย่า...'
      },
      modal: {
        congrats: 'ยินดีด้วย!',
        removeWinner: 'ลบผู้ชนะออก',
        removeAllWinner: 'ลบผู้ชนะทั้งหมดออก'
      },
      common: { close: 'ปิด', undo: 'เลิกทำ' },
      toast: { winnerRemoved: 'ลบผู้ชนะแล้ว' },
      // NEW (not from the original source): mobile shake feature
      motion: {
        enable: 'เขย่าโทรศัพท์', requesting: '...', on: 'เขย่าโทรศัพท์: เปิด',
        hint: 'เขย่าโทรศัพท์เพื่อเขย่าเซียมซี',
        denied: 'ไม่ได้รับอนุญาตให้ตรวจจับการเคลื่อนไหว — กดค้างหรือปัดเพื่อเขย่าแทน',
        unavailable: 'ไม่พบเซ็นเซอร์การเคลื่อนไหว — กดค้างหรือปัดเพื่อเขย่าแทน',
        fallback: 'กดค้างหรือปัดเพื่อเขย่าแทน'
      }
    }
  };
})(window);
