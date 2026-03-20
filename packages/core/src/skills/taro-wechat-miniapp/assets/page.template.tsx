import { View, Text } from '@tarojs/components';
import Taro, { useLoad } from '@tarojs/taro';
import { useMemo, useState } from 'react';

import { usePageData } from './use-page-data';

type PageState = 'idle' | 'loading' | 'error' | 'ready';

export default function __PAGE_NAME__Page() {
  const [keyword, setKeyword] = useState('');
  const { data, error, isLoading, reload } = usePageData();

  useLoad(() => {
    void reload();
  });

  const state: PageState = useMemo(() => {
    if (isLoading) return 'loading';
    if (error) return 'error';
    if (data) return 'ready';
    return 'idle';
  }, [data, error, isLoading]);

  const handleRefresh = async () => {
    await reload();
    Taro.stopPullDownRefresh();
  };

  if (state === 'loading') {
    return (
      <View className="__page-name__ __page-name__--loading">
        <Text>加载中...</Text>
      </View>
    );
  }

  if (state === 'error') {
    return (
      <View className="__page-name__ __page-name__--error">
        <Text>加载失败，请稍后重试</Text>
        <Text onClick={() => void handleRefresh()}>重新加载</Text>
      </View>
    );
  }

  return (
    <View className="__page-name__">
      <Text className="__page-name__title">__PAGE_TITLE__</Text>
      <Text className="__page-name__keyword">{keyword}</Text>
      <Text>{data?.title ?? '暂无数据'}</Text>
      <Text onClick={() => setKeyword('example')}>更新关键词</Text>
    </View>
  );
}
