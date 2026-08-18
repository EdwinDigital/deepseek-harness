/** Locale bundles owned by the Microsoft Web IQ settings card. */

/** Locale keys rendered by this package's browser half. */
export type MicrosoftWebIqLocaleKey =
  | 'title' | 'description' | 'expand' | 'collapse'
  | 'apiKey' | 'apiKeyHint' | 'apiKeySet' | 'apiKeyUnset'
  | 'saveApiKey' | 'savingApiKey' | 'apiKeyFailed'
  | 'credentialRef' | 'endpoint' | 'language' | 'region' | 'maxLength'
  | 'safeSearch' | 'strict' | 'off' | 'saveSettings' | 'savingSettings'
  | 'invalidSettings' | 'readOnly' | 'settingsFailed'
  | 'setDefault' | 'settingDefault' | 'defaultSelected' | 'defaultFailed'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Microsoft Web IQ provider configuration copy. */
    'web-search.microsoft-webiq': MicrosoftWebIqLocaleKey
  }
}

/** English copy. */
export const en: Record<MicrosoftWebIqLocaleKey, string> = {
  title: 'Microsoft Web IQ',
  description: 'Web grounding through Microsoft Web IQ.',
  expand: 'Show settings',
  collapse: 'Hide settings',
  apiKey: 'API key',
  apiKeyHint: 'Stored through the credential service. Leave blank to keep the current key.',
  apiKeySet: 'A key is configured.',
  apiKeyUnset: 'No key is configured.',
  saveApiKey: 'Save API key',
  savingApiKey: 'Saving API key...',
  apiKeyFailed: 'The API key was not accepted.',
  credentialRef: 'Credential reference',
  endpoint: 'Endpoint',
  language: 'Language',
  region: 'Region',
  maxLength: 'Passage length',
  safeSearch: 'SafeSearch',
  strict: 'Strict',
  off: 'Off',
  saveSettings: 'Save settings',
  savingSettings: 'Saving settings...',
  invalidSettings: 'Correct the invalid setting values before saving.',
  readOnly: 'This deployment stores provider settings read-only.',
  settingsFailed: 'The provider settings were not accepted.',
  setDefault: 'Set as default',
  settingDefault: 'Setting as default...',
  defaultSelected: 'Default search provider',
  defaultFailed: 'The default search provider was not changed.',
}

/** Simplified Chinese copy. */
export const zh: Record<MicrosoftWebIqLocaleKey, string> = {
  title: 'Microsoft Web IQ',
  description: '通过 Microsoft Web IQ 提供网页检索依据。',
  expand: '展开设置',
  collapse: '收起设置',
  apiKey: 'API Key',
  apiKeyHint: '通过凭据服务存储；留空表示保留当前密钥。',
  apiKeySet: '已配置密钥。',
  apiKeyUnset: '未配置密钥。',
  saveApiKey: '保存 API Key',
  savingApiKey: '正在保存 API Key...',
  apiKeyFailed: 'API Key 未被接受。',
  credentialRef: '凭据引用',
  endpoint: '接口地址',
  language: '语言',
  region: '地区',
  maxLength: '段落长度',
  safeSearch: '安全搜索',
  strict: '严格',
  off: '关闭',
  saveSettings: '保存设置',
  savingSettings: '正在保存设置...',
  invalidSettings: '请先修正无效的设置值。',
  readOnly: '本部署的提供方设置为只读。',
  settingsFailed: '提供方设置未被接受。',
  setDefault: '设为默认',
  settingDefault: '正在设为默认...',
  defaultSelected: '默认搜索提供方',
  defaultFailed: '默认搜索提供方未更改。',
}
