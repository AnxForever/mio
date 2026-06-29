#!/usr/bin/env node

const PROVIDER_ENV = {
  anthropic: 'ANTHROPIC_API_KEY',
  openai: 'OPENAI_API_KEY',
  deepseek: 'DEEPSEEK_API_KEY',
  moonshot: 'MOONSHOT_API_KEY',
  zhipu: 'ZHIPU_API_KEY',
  minimax: 'MINIMAX_API_KEY',
  hybgzs: 'HYBGZS_API_KEY',
  qwen: 'DASHSCOPE_API_KEY',
  doubao: 'DOUBAO_API_KEY',
  siliconflow: 'SILICONFLOW_API_KEY',
};

export function splitProviders(value) {
  return String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

export function hasRealProvider(providers) {
  return providers.some((provider) => provider.toLowerCase() !== 'mock');
}

export function diagnoseCompanionProviders(providers, env = process.env) {
  return splitProviders(providers).map((provider) => {
    const name = provider.toLowerCase();
    const isMock = name === 'mock';
    const envVar = PROVIDER_ENV[name] || (name === 'lora' ? 'MIO_LORA_API_KEY' : '');
    const credentialRequired = !isMock && name !== 'lora';
    const credentialPresent = !credentialRequired || (envVar ? Boolean(env[envVar]) : false);
    const known = isMock || name === 'lora' || Boolean(envVar);
    return {
      provider,
      known,
      isMock,
      envVar,
      credentialRequired,
      credentialPresent,
      usableForVerifiedRestart: !isMock && known && credentialPresent,
    };
  });
}

export function validateCompanionGatePolicy(input) {
  const providers = splitProviders(input.providers);
  const requireRealProvider = input.requireRealProvider === true || input.requireRealProvider === 'true';
  const diagnostics = diagnoseCompanionProviders(input.providers, input.env);
  const realProvider = hasRealProvider(providers);
  const usableRealProvider = diagnostics.some((item) => item.usableForVerifiedRestart);
  const missingCredentialProviders = diagnostics
    .filter((item) => !item.isMock && item.known && item.credentialRequired && !item.credentialPresent)
    .map((item) => `${item.provider} (${item.envVar})`);
  const unknownProviders = diagnostics
    .filter((item) => !item.known)
    .map((item) => item.provider);
  const ok = !requireRealProvider || usableRealProvider;
  return {
    ok,
    providers,
    requireRealProvider,
    hasRealProvider: realProvider,
    hasUsableRealProvider: usableRealProvider,
    diagnostics,
    reason: ok
      ? ''
      : renderFailureReason({ realProvider, missingCredentialProviders, unknownProviders }),
  };
}

function renderFailureReason(input) {
  if (!input.realProvider) {
    return 'Verified WeChat restart requires at least one non-mock companion provider.';
  }
  const parts = ['Verified WeChat restart requires at least one usable non-mock companion provider.'];
  if (input.missingCredentialProviders.length > 0) {
    parts.push(`Missing credentials: ${input.missingCredentialProviders.join(', ')}.`);
  }
  if (input.unknownProviders.length > 0) {
    parts.push(`Unknown providers: ${input.unknownProviders.join(', ')}.`);
  }
  return parts.join(' ');
}

function parseArgs(argv) {
  const args = {};
  for (const arg of argv) {
    const idx = arg.indexOf('=');
    if (!arg.startsWith('--') || idx <= 2) continue;
    args[arg.slice(2, idx)] = arg.slice(idx + 1);
  }
  return args;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = parseArgs(process.argv.slice(2));
  const result = validateCompanionGatePolicy({
    providers: args.providers,
    requireRealProvider: args['require-real-provider'],
  });
  if (!result.ok) {
    console.error(result.reason);
    console.error(`Selected providers: ${result.providers.join(',') || '(none)'}`);
    for (const item of result.diagnostics) {
      if (item.isMock) continue;
      console.error(`Provider ${item.provider}: env=${item.envVar || '(unknown)'} credential=${item.credentialPresent ? 'present' : 'missing'}`);
    }
    process.exit(2);
  }
  console.log(JSON.stringify(result));
}
