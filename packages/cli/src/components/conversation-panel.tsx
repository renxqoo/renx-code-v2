import type { ChatTurn } from '../types/chat';
import type { SubagentRunViewModel } from '../types/subagent-run';
import { uiTheme } from '../ui/theme';
import { TurnItem } from './chat/turn-item';

type ConversationPanelProps = {
  turns: ChatTurn[];
  isThinking: boolean;
  activeRuns?: SubagentRunViewModel[];
};

export const ConversationPanel = ({ turns, isThinking, activeRuns = [] }: ConversationPanelProps) => {
  const pendingTurnId = turns.at(-1)?.id;

  return (
    <scrollbox
      flexGrow={1}
      scrollY
      stickyScroll
      stickyStart="bottom"
      paddingX={uiTheme.layout.conversationPaddingX}
      paddingY={uiTheme.layout.conversationPaddingY}
      viewportOptions={{ backgroundColor: uiTheme.bg }}
      contentOptions={{ backgroundColor: uiTheme.bg }}
      marginBottom={1}
    >
      <box
        flexDirection="column"
        gap={0}
        paddingX={uiTheme.layout.conversationContentPaddingX}
        paddingY={uiTheme.layout.conversationContentPaddingY}
        backgroundColor={uiTheme.bg}
      >
        {turns.map((turn, index) => {
          const isPendingTurn = isThinking && turn.id === pendingTurnId;
          const activeRunsForTurn =
            isPendingTurn && activeRuns.length > 0
              ? activeRuns.filter((run) => run.status !== 'completed')
              : undefined;

          return (
            <TurnItem
              key={turn.id}
              turn={turn}
              index={index}
              isPending={isPendingTurn}
              activeRuns={activeRunsForTurn}
            />
          );
        })}
      </box>
    </scrollbox>
  );
};
