function normalizeDigits(value) {
  return String(value || '').replace(/[۰-۹]/g, (d) => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d));
}

function parseCommand(text, command) {
  const match = String(text || '').match(new RegExp(`^\\/${command}(?:@[^\\s]+)?(?:\\s+([\\s\\S]*))?$`, 'i'));
  return match ? String(match[1] || '').trim() : null;
}

function adminMessagingMiddleware({ storage, isAdmin, telegram, log }) {
  return async (ctx, next) => {
    if (!isAdmin(ctx) || !ctx.message?.text) return next();

    const text = String(ctx.message.text).trim();
    const broadcastArg = parseCommand(text, 'broadcast');
    if (broadcastArg !== null) {
      if (broadcastArg) return sendBroadcast(ctx, broadcastArg, { storage, telegram, log });
      await storage.setState('admin', ctx.from.id, { stage: 'AWAITING_BROADCAST_MESSAGE' });
      return ctx.reply('📢 متن پیام همگانی را ارسال کنید.\n\nبرای لغو: /cancel');
    }

    const messageArg = parseCommand(text, 'message');
    if (messageArg !== null) {
      if (messageArg) {
        const parts = messageArg.split(/\s+/);
        const targetId = normalizeDigits(parts.shift());
        const messageText = parts.join(' ').trim();
        if (!/^\d+$/.test(targetId)) return ctx.reply('❌ شناسه کاربر نامعتبر است.\n\nاستفاده: /message TELEGRAM_ID متن پیام');
        if (!messageText) {
          await storage.setState('admin', ctx.from.id, { stage: 'AWAITING_DIRECT_MESSAGE', targetId });
          return ctx.reply(`👤 کاربر ${targetId} انتخاب شد. متن پیام را ارسال کنید.\n\nبرای لغو: /cancel`);
        }
        return sendDirectMessage(ctx, targetId, messageText, { telegram, log });
      }
      await storage.setState('admin', ctx.from.id, { stage: 'AWAITING_MESSAGE_USER_ID' });
      return ctx.reply('👤 شناسه عددی تلگرام کاربر را ارسال کنید.\n\nبرای لغو: /cancel');
    }

    if (text === '/cancel') {
      const state = await storage.getState('admin', ctx.from.id);
      if (state) {
        await storage.deleteState('admin', ctx.from.id);
        return ctx.reply('✅ عملیات لغو شد.');
      }
    }

    const state = await storage.getState('admin', ctx.from.id);
    if (!state) return next();

    if (state.stage === 'AWAITING_BROADCAST_MESSAGE') {
      await storage.deleteState('admin', ctx.from.id);
      return sendBroadcast(ctx, text, { storage, telegram, log });
    }

    if (state.stage === 'AWAITING_MESSAGE_USER_ID') {
      const targetId = normalizeDigits(text);
      if (!/^\d+$/.test(targetId)) return ctx.reply('❌ شناسه نامعتبر است. یک شناسه عددی تلگرام ارسال کنید.');
      await storage.setState('admin', ctx.from.id, { stage: 'AWAITING_DIRECT_MESSAGE', targetId });
      return ctx.reply(`👤 کاربر ${targetId} انتخاب شد. متن پیام را ارسال کنید.\n\nبرای لغو: /cancel`);
    }

    if (state.stage === 'AWAITING_DIRECT_MESSAGE') {
      await storage.deleteState('admin', ctx.from.id);
      return sendDirectMessage(ctx, state.targetId, text, { telegram, log });
    }

    return next();
  };
}

async function sendDirectMessage(ctx, targetId, messageText, { telegram, log }) {
  try {
    await telegram.sendMessage(targetId, messageText);
    return ctx.reply(`✅ پیام با موفقیت به کاربر ${targetId} ارسال شد.`);
  } catch (error) {
    log('ADMIN_DIRECT_MESSAGE_FAILED', { telegram_user_id: targetId, error: error?.message || String(error) });
    return ctx.reply(`❌ ارسال پیام به کاربر ${targetId} انجام نشد. ممکن است ربات توسط کاربر بلاک شده باشد یا شناسه اشتباه باشد.`);
  }
}

async function sendBroadcast(ctx, messageText, { storage, telegram, log }) {
  const users = await storage.smembers('bot_users');
  let success = 0;
  let failed = 0;

  for (const id of users) {
    try {
      await telegram.sendMessage(id, messageText);
      success++;
    } catch (error) {
      failed++;
      const description = String(error?.description || error?.message || '');
      if (/blocked|chat not found|user is deactivated/i.test(description)) {
        await storage.srem('bot_users', id);
        await storage.markUserBlocked(id, description).catch(() => {});
      }
      log('ADMIN_BROADCAST_DELIVERY_FAILED', { telegram_user_id: id, error: description });
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  return ctx.reply(`✅ ارسال همگانی پایان یافت.\n\n👥 کاربران: ${users.length}\n✅ موفق: ${success}\n❌ ناموفق: ${failed}`);
}

module.exports = { adminMessagingMiddleware };