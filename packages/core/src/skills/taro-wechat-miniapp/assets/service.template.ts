import Taro from '@tarojs/taro';

export interface __DATA_TYPE__ {
  title: string;
}

export async function __SERVICE_NAME__(): Promise<__DATA_TYPE__> {
  const response = await Taro.request<__DATA_TYPE__>({
    url: '__REQUEST_URL__',
    method: 'GET',
  });

  return response.data;
}
