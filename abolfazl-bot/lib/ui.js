const { Markup } = require('telegraf');
const accountService = require('./account-service');
const accountUI = require('./account-ui');
const { serviceButtons } = require('./services');

function buttonStyleForCallback(callbackData) {
  const data = String(callbackData || '');
  if (data === 'main_test' || data.startsWith('service_test_') || data.startsWith('test_') || data === 'channel_gate_check' || data.startsWith('account_renew:') || data.startsWith('renew_')) return 'success';
  if (data === 'main_buy' || data === 'main_wallet' || data === 'main_account' || data === 'main_support' || data === 'main_home' || data.startsWith('service_buy_') || data.startsWith('service_renew_') || data.startsWith('wallet_') || data.startsWith('payment_') || data.startsWith('back_') || data.startsWith('menu_') || data.startsWith('account_') || data.startsWith('copy_sub:') || data.startsWith('auto_name_') || data.startsWith('select_plan_')) return 'primary';
  if (data.startsWith('disable_') || data.startsWith('cancel_') || data.startsWith('delete_') || data.startsWith('danger_')) return 'danger';
  return null;
}

function styledButton(button) {
  if (!button || typeof button !== 'object') return button;
  const style = button.style || buttonStyleForCallback(button.callback_data) || 'primary';
  return { ...button, style };
}

function homeButton() { return { text: '🏠 منوی اصلی', callback_data: 'main_home', style: 'primary' }; }

function mainMenuKeyboard(config = {}) {
  const b = config.buttons || {};
  return Markup.inlineKeyboard([
    [{ text: b.test || '🎁 دریافت اکانت تست', callback_data: 'main_test', style: 'success' }],
    [{ text: b.buy || '🛒 خرید اشتراک', callback_data: 'main_buy', style: 'primary' }],
    [{ text: b.wallet || '💰 کیف پول من', callback_data: 'main_wallet', style: 'primary' }, { text: b.account || '👤 حساب من', callback_data: 'main_account', style: 'primary' }],
    [{ text: b.support || '🎯 پشتیبانی', callback_data: 'main_support', style: 'primary' }],
  ]);
}

function withHome(rows) {
  const normalized = Array.isArray(rows) ? rows.map(row => Array.isArray(row) ? row.map(styledButton) : row) : [];
  if (!normalized.some(row => Array.isArray(row) && row.some(button => button?.callback_data === 'main_home'))) normalized.push([homeButton()]);
  return normalized;
}

function decorateReplyOptions(options) {
  if (!options || !options.reply_markup) return options;
  const rm = options.reply_markup;
  if (!Array.isArray(rm.inline_keyboard)) return options;
  const rows = rm.inline_keyboard;
  const isMainMenu = rows.some(row => Array.isArray(row) && row.some(button => ['main_test', 'main_buy', 'main_wallet', 'main_account', 'main_support'].includes(button?.callback_data)));
  const styledRows = rows.map(row => Array.isArray(row) ? row.map(styledButton) : row);
  return { ...options, reply_markup: { ...rm, inline_keyboard: isMainMenu ? styledRows : withHome(styledRows) } };
}

function patchReply() {
  const proto = require('telegraf').Telegraf.prototype;
  if (proto.__uiReplyPatched) return;
  const originalReply = proto.context.reply;
  proto.context.reply = function(text, extra, ...rest) {
    return originalReply.call(this, text, decorateReplyOptions(extra), ...rest);
  };
  proto.__uiReplyPatched = true;
}

async function handle(ctx, next, { getConfig, getMessage, persistUser }) {
  const start = ctx.message?.text || '';
  if (/^\/start(?:@\w+)?(?:\s+.*)?$/.test(start)) {
    await persistUser(ctx);
    const config = await getConfig();
    await ctx.reply(await getMessage('start'), mainMenuKeyboard(config));
    return;
  }
  const data = ctx.callbackQuery?.data || '';
  if (!['main_home', 'main_test', 'main_buy', 'main_wallet', 'main_account', 'main_support'].includes(data)) return next();
  await ctx.answerCbQuery().catch(() => {});
  await persistUser(ctx);
  if (data === 'main_home') {
    const config = await getConfig();
    return ctx.reply(await getMessage('start'), mainMenuKeyboard(config));
  }
  if (data === 'main_test' || data === 'main_buy') {
    const config = await getConfig();
    const mode = data === 'main_test' ? 'test' : 'buy';
    const titleKey = mode === 'test' ? 'serviceSelectionTest' : 'serviceSelectionBuy';
    const prefix = mode === 'test' ? 'service_test_' : 'service_buy_';
    const buttons = serviceButtons(prefix, config, mode);
    if (!buttons.length) return ctx.reply(await getMessage('serviceUnavailable'));
    return ctx.reply(await getMessage(titleKey), Markup.inlineKeyboard(withHome(buttons)));
  }
  if (data === 'main_wallet') {
    const balance = await require('./wallet').getBalance(ctx.from.id);
    await require('./storage').setState('user', ctx.from.id, { stage: 'AWAITING_WALLET_AMOUNT', orderId: null, requiredAmount: 0, balance });
    return ctx.reply(`💰 <b>کیف پول من</b>\n\nموجودی فعلی: <b>${balance.toLocaleString('en-US')} تومان</b>\n\nمبلغی که می‌خواهید کیف پول را شارژ کنید به تومان وارد کنید.`, { parse_mode: 'HTML', reply_markup: { inline_keyboard: withHome([]) } });
  }
  if (data === 'main_account') {
    const subscriptions = await accountService.listSubscriptions(ctx.from.id);
    const list = subscriptions.map(accountService.summary);
    if (!list.length) return ctx.reply(await getMessage('accountNoSubscription'));
    return ctx.reply('👤 <b>حساب من</b>\n\nاشتراک موردنظر را انتخاب کنید:', { parse_mode: 'HTML', reply_markup: { inline_keyboard: withHome(accountUI.subscriptionKeyboard(list)) } });
  }
  if (data === 'main_support') {
    const config = await getConfig();
    const username = config.payment?.supportUsername || process.env.SUPPORT_USERNAME || 'Your_Personal_ID';
    return ctx.reply(await getMessage('support', { support_username: username }));
  }
}

function install(bot, deps) {
  patchReply();
  if (bot.__uiInstalled) return;
  bot.__uiInstalled = true;
  const originalUse = require('telegraf').Telegraf.prototype.use;
  originalUse.call(bot, (ctx, next) => handle(ctx, next, deps));
}

module.exports = { buttonStyleForCallback, styledButton, homeButton, mainMenuKeyboard, withHome, decorateReplyOptions, patchReply, handle, install };
