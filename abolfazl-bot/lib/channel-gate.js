const { Markup } = require('telegraf');
const { adminMessagingMiddleware } = require('./admin-messaging');
const ui = require('./ui');

function normalizeUsername(value) {
  const raw = String(value || '').trim().replace(/^https?:\/\/t\.me\//i, '').replace(/^@+/, '');
  return raw ? `@${raw}` : '';
}

function joinUrl(username) {
  return `https://t.me/${String(username || '').replace(/^@/, '')}`;
}

function isJoined(member) {
  if (!member) return false;
  if (['creator', 'administrator', 'member'].includes(member.status)) return true;
  if (member.status === 'restricted') return member.is_member === true;
  return false;
}

function createGate(bot, { getConfig, getMessage, isAdmin, log }) {
  ui.install(bot, { getConfig, getMessage, isAdmin, persistUser: async () => {} });

  const adminMessaging = adminMessagingMiddleware({
    storage: require('./storage'),
    isAdmin,
    telegram: bot.telegram,
    log,
  });

  async function check(userId, username) {
    const config = await getConfig();
    const gate = config.channelGate || {};
    if (!gate.enabled) return { enabled: false, joined: true };
    const channel = normalizeUsername(gate.channelUsername);
    if (!channel) return { enabled: false, joined: true, reason: 'CHANNEL_NOT_CONFIGURED' };
    try {
      const member = await bot.telegram.getChatMember(channel, userId);
      return { enabled: true, joined: isJoined(member), channel, username };
    } catch (error) {
      log('CHANNEL_MEMBERSHIP_CHECK_FAILED', {
        telegram_user_id: userId,
        channel,
        error: error?.message || String(error),
      });
      return { enabled: true, joined: false, channel, error: error?.message || String(error) };
    }
  }

  async function sendGate(ctx, config) {
    const gate = config.channelGate || {};
    const channel = normalizeUsername(gate.channelUsername);
    if (!channel) return false;
    const text = String(gate.message || 'برای استفاده از ربات ابتدا در کانال عضو شوید.');
    const joinText = String(gate.joinButton || '📢 عضویت در کانال');
    const checkText = String(gate.checkButton || '✅ بررسی عضویت');
    return ctx.reply(text, {
      reply_markup: Markup.inlineKeyboard([
        [{ text: joinText, url: joinUrl(channel), style: 'primary' }],
        [{ text: checkText, callback_data: 'channel_gate_check', style: 'success' }],
      ]).reply_markup,
    });
  }

  return async function channelGateMiddleware(ctx, next) {
    if (!ctx.from) return next();
    if (isAdmin(ctx)) return adminMessaging(ctx, next);

    const config = await getConfig();
    const gate = config.channelGate || {};
    if (!gate.enabled || !normalizeUsername(gate.channelUsername)) return next();

    const isCheck = ctx.callbackQuery?.data === 'channel_gate_check';
    if (isCheck) {
      const result = await check(ctx.from.id, ctx.from.username || '');
      if (result.joined) {
        await ctx.answerCbQuery('عضویت شما تأیید شد ✅').catch(() => {});
        const uiConfig = await getConfig();
        await ctx.reply(await getMessage('start'), ui.mainMenuKeyboard(uiConfig));
      } else {
        await ctx.answerCbQuery('هنوز عضویت شما تأیید نشد. ابتدا وارد کانال شوید.').catch(() => {});
        await sendGate(ctx, config);
      }
      return;
    }

    const result = await check(ctx.from.id, ctx.from.username || '');
    if (result.joined) return next();

    if (ctx.callbackQuery) {
      await ctx.answerCbQuery('ابتدا باید در کانال عضو شوید.').catch(() => {});
    }
    await sendGate(ctx, config);
  };
}

module.exports = { createGate, normalizeUsername, isJoined };
