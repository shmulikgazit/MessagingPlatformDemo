const lpm = require('lp-messaging-sdk');
require('dotenv').config();

const usePassword =
  (process.env.LP_AUTH_MODE && process.env.LP_AUTH_MODE.trim() === 'password') ||
  (process.env.LPM_PASSWORD && String(process.env.LPM_PASSWORD).length > 0);

if (usePassword) {
  const need = ['ACCOUNT_ID', 'LPM_USERNAME', 'LPM_PASSWORD'];
  const miss = need.filter((k) => !process.env[k] || !String(process.env[k]).trim());
  if (miss.length) {
    console.error('Password mode: set ACCOUNT_ID, LPM_USERNAME, LPM_PASSWORD in .env (or use OAuth1 keys without LPM_PASSWORD).');
    miss.forEach((k) => console.error(` - missing: ${k}`));
    process.exit(1);
  }
} else {
  const requiredEnv = [
    'ACCOUNT_ID',
    'LPM_USERNAME',
    'APP_KEY',
    'APP_SECRET',
    'ACCESS_TOKEN',
    'ACCESS_TOKEN_SECRET',
  ];
  const missingEnv = requiredEnv.filter((key) => !process.env[key]);
  if (missingEnv.length > 0) {
    console.error('Error: Missing environment variables in .env file:');
    missingEnv.forEach((key) => console.error(` - ${key}`));
    console.log('\nAlternatively set LPM_PASSWORD for human agent login (password mode).');
    process.exit(1);
  }
}

console.log(`Attempting to connect to Account: ${process.env.ACCOUNT_ID}`);

const host = process.env.PROXY_HOST || process.env.FIDDLER_HOST;
const port = process.env.PROXY_PORT || process.env.FIDDLER_PORT;
if (host && port) {
  lpm.configureProxy({
    host,
    port: Number(port),
    protocol: 'http',
  });
} else {
  lpm.resetProxy();
}

if (process.env.USE_FIDDLER === '1' || process.env.ALLOW_INSECURE_TLS === '1') {
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
}

const authData = usePassword
  ? {
      username: String(process.env.LPM_USERNAME).trim(),
      password: String(process.env.LPM_PASSWORD),
    }
  : {
      username: process.env.LPM_USERNAME,
      appKey: process.env.APP_KEY,
      secret: process.env.APP_SECRET,
      accessToken: process.env.ACCESS_TOKEN,
      accessTokenSecret: process.env.ACCESS_TOKEN_SECRET,
    };

const connection = lpm.createConnection({
  appId: 'test_connection_app',
  accountId: process.env.ACCOUNT_ID,
  userType: lpm.UserType.BRAND,
  responseTimeout: 30000,
  authData,
});

// Event Listeners for Debugging
connection.on('error', (err) => {
  console.error('\n[SDK Error Event]:');
  console.error(err);

  if (err.message && err.message.includes('websocket')) {
    console.error('\n--- Proxy/Network Debugging Info ---');
    console.error('1. The "Error opening websocket connection" often happens if the proxy allows HTTP/HTTPS but blocks the WS/WSS protocol.');
    console.error('2. Ensure the proxy supports WebSocket upgrades (HTTP 101).');
    console.error('3. Check if your corporate firewall is blocking the domain: *.liveperson.net or *.lpcdn.net');
    console.error('4. If using `lpm.configureProxy`, the SDK uses it for both HTTP (auth) and WebSocket traffic.');
  }
});

const onConnected = async () => {
  console.log('\n[Connection Ready/Connect Event]: Successfully established connection!');
  console.log('You can now interact with the Messaging Platform.');

  try {
    console.log('\n--- Fetching Message Statistics ---');
    const stats = await connection.getMessageStatisticsForUser();
    console.log('User Statistics:', JSON.stringify(stats, null, 2));

    console.log('\n--- Subscribing to Open Conversations ---');
    await connection.createConversationSubscription({
      query: { stage: ['OPEN'] },
    });
    console.log('Subscription created. Waiting for conversation events...');
  } catch (err) {
    console.error('Error during post-connection actions:', err);
  }
};

connection.on('connect', onConnected);
connection.on('ready', onConnected);

connection.on('close', (reason) => {
  console.log('\n[Close Event]: Connection was closed.');
  console.log('Reason:', JSON.stringify(reason, null, 2));
});

connection.on('reconnecting', () => {
  console.log('\n[Reconnecting Event]: Attempting to reconnect...');
});

connection.on('conversation', (conversation) => {
  console.log(`\n[Conversation Event]: Found conversation ID: ${conversation.conversationId}`);
  console.log(`- State: ${conversation.state}`);
  console.log(
    `- Last Message: ${
      conversation.lastMessage ? conversation.lastMessage.text || 'Non-text message' : 'No messages yet'
    }`
  );
});

const originalEmit = connection.emit;
connection.emit = function (event, ...args) {
  if (
    [
      'request',
      'notification',
      'messageNotification',
      'conversationNotification',
      '.GetClock#request',
      '.GetClock#response',
    ].includes(event)
  ) {
    return originalEmit.apply(this, [event, ...args]);
  }

  if (event === 'limit-break') {
    const data = args[0];
    console.log(`[Event Emitted]: ${event} (Initial conversations found: ${data.notificationChangeCount})`);
  } else {
    console.log(`[Event Emitted]: ${event}`);
  }
  return originalEmit.apply(this, [event, ...args]);
};

async function runTest() {
  try {
    console.log('Calling connection.open()...');
    await connection.open();
    console.log('connection.open() promise resolved.');
  } catch (error) {
    console.error('\n[Connection Open Catch]: Failed to open connection.');
    console.error(error);

    if (error.name === 'VError') {
      console.error('\nVError details:');
      console.error('- Message:', error.message);
      if (error.cause) {
        console.error('- Cause:', error.cause());
      }
    }
  }
}

runTest();
