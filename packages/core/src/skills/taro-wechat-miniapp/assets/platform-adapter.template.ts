export interface __FEATURE_NAME__AdapterResult {
  value: string;
}

export interface __FEATURE_NAME__Adapter {
  run(): Promise<__FEATURE_NAME__AdapterResult>;
}

export class Weapp__FEATURE_NAME__Adapter implements __FEATURE_NAME__Adapter {
  async run(): Promise<__FEATURE_NAME__AdapterResult> {
    return {
      value: '__WEAPP_VALUE__',
    };
  }
}

export class Alipay__FEATURE_NAME__Adapter implements __FEATURE_NAME__Adapter {
  async run(): Promise<__FEATURE_NAME__AdapterResult> {
    return {
      value: '__ALIPAY_VALUE__',
    };
  }
}

export class Toutiao__FEATURE_NAME__Adapter implements __FEATURE_NAME__Adapter {
  async run(): Promise<__FEATURE_NAME__AdapterResult> {
    return {
      value: '__TOUTIAO_VALUE__',
    };
  }
}

export function create__FEATURE_NAME__Adapter(platform: 'weapp' | 'alipay' | 'tt') {
  switch (platform) {
    case 'alipay':
      return new Alipay__FEATURE_NAME__Adapter();
    case 'tt':
      return new Toutiao__FEATURE_NAME__Adapter();
    case 'weapp':
    default:
      return new Weapp__FEATURE_NAME__Adapter();
  }
}
