失败点在“工具真正执行之前”的确认阶段。

准确链路是：

1. `DefaultToolManager.execute(...)`  
   在 [tool-manager.ts](/D:/work/renx-code/packages/core/src/agent/tool/tool-manager.ts)

2. 这里先调用 `handler.shouldConfirm(...)`  
   关键位置在 [tool-manager.ts](/D:/work/renx-code/packages/core/src/agent/tool/tool-manager.ts#L178)

3. 对 `bash` 来说，`shouldConfirm()` 会调用 `validatePolicy()`  
   在 [bash.ts](/D:/work/renx-code/packages/core/src/agent/tool/bash.ts#L104)

4. `validatePolicy()` 里调用 `evaluateBashPolicy()`  
   在 [bash.ts](/D:/work/renx-code/packages/core/src/agent/tool/bash.ts#L235)

5. `evaluateBashPolicy()` 里 `extractSegmentCommands(command)` 会直接 `parse(command)`  
   在 [bash-policy.ts](/D:/work/renx-code/packages/core/src/agent/tool/bash-policy.ts#L549)

6. `shell-quote` 在解析 heredoc 里的 `${String(1)}` 时抛出  
   `Bad substitution: String`  
   抛错位置在 [parse.js](/D:/work/renx-code/node_modules/.pnpm/shell-quote@1.8.3/node_modules/shell-quote/parse.js#L128)

所以“在哪里执行失败”答案是：

- 不是失败在 shell 进程
- 不是失败在 `BashTool.execute()` 里的 `spawn(...)`
- 是失败在 `shouldConfirm -> validatePolicy -> shell-quote.parse()` 这一层

也因此：

- `BashTool.execute()` 的 `try/catch` 根本还没来得及进
- 没有生成对应 `tool-result`
- 异常直接往上冒到 agent run loop 了

如果你愿意，我可以下一步把这条链路画成一张很短的时序图给你。
