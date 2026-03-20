import { View, Text } from '@tarojs/components';

export interface __COMPONENT_NAME__Props {
  title: string;
  description?: string;
  isActive?: boolean;
  onPress?: () => void;
}

export function __COMPONENT_NAME__({
  title,
  description,
  isActive = false,
  onPress,
}: __COMPONENT_NAME__Props) {
  return (
    <View
      className={`__component-name__ ${isActive ? '__component-name__--active' : ''}`}
      onClick={onPress}
    >
      <Text className="__component-name__title">{title}</Text>
      {description ? <Text className="__component-name__desc">{description}</Text> : null}
    </View>
  );
}

export default __COMPONENT_NAME__;
