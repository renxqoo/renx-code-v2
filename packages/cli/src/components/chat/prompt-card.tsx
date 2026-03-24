import {
  isAudioSelection,
  isImageSelection,
  isVideoSelection,
} from '../../files/attachment-capabilities';
import { uiTheme } from '../../ui/theme';

type PromptCardProps = {
  prompt: string;
  files?: string[];
  createdAtMs?: number;
  isFirst?: boolean;
};

export const PromptCard = ({
  prompt,
  files = [],
  createdAtMs: _createdAtMs,
  isFirst = false,
}: PromptCardProps) => {
  const mediaFiles = files.filter(
    (file) =>
      isImageSelection({ relativePath: file, absolutePath: file, size: 0 }) ||
      isAudioSelection({ relativePath: file, absolutePath: file, size: 0 }) ||
      isVideoSelection({ relativePath: file, absolutePath: file, size: 0 })
  );

  return (
    <box flexDirection="row" marginTop={isFirst ? 0 : 1} marginBottom={1}>
      <box
        border={['left']}
        borderColor={uiTheme.accent}
        customBorderChars={{
          topLeft: '',
          topRight: '',
          bottomRight: '',
          horizontal: ' ',
          bottomT: '',
          topT: '',
          cross: '',
          leftT: '',
          rightT: '',
          vertical: '┃',
          bottomLeft: '╹',
        }}
      />
      <box
        flexGrow={1}
        backgroundColor={uiTheme.userPromptBg}
        paddingLeft={2}
        paddingRight={1}
        paddingTop={1}
        paddingBottom={1}
      >
        <text
          fg={uiTheme.userPromptText}
          attributes={uiTheme.typography.heading}
          wrapMode="word"
          selectable={true}
        >
          {prompt}
        </text>
        {mediaFiles.length > 0 ? (
          <box paddingTop={1} flexDirection="column">
            <text fg={uiTheme.muted} attributes={uiTheme.typography.note}>
              Media files
            </text>
            {mediaFiles.map((file) => (
              <text
                key={file}
                fg={uiTheme.text}
                attributes={uiTheme.typography.note}
                selectable={true}
              >
                {file}
              </text>
            ))}
          </box>
        ) : null}
      </box>
    </box>
  );
};
