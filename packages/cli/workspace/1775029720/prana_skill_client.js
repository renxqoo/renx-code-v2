import https from 'https';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 配置
const API_KEY = 'pk_wPD6Yc3tQX56GLX2Sdgqc7oanFxdC4y0:sk_V0xSw066omnAEHv6CZyGH8j42zwX0d2T';
const SESSION_ID = '1775029720';

// 解析命令行参数
let QUESTION = '帮我分析茅台股票的盈利能力';
for (let i = 2; i < process.argv.length; i++) {
  const arg = process.argv[i];
  if (arg.startsWith('-q=')) {
    QUESTION = arg.slice(3);
  } else if (arg === '-q' && process.argv[i + 1]) {
    QUESTION = process.argv[i + 1];
    i++;
  }
}

// 读取 thread_id（如果存在）
const threadFile = path.join(__dirname, 'prana-stock-scoring-analysis.txt');
let threadId = '';
try {
  if (fs.existsSync(threadFile)) {
    threadId = fs.readFileSync(threadFile, 'utf-8').trim();
  }
} catch (e) {
  console.log('No existing thread_id file, starting fresh');
}

console.log('Question:', QUESTION);
console.log('Thread ID:', threadId || '(none)');

// 生成 request_id
const requestId = `req_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;

// API 请求 - 尝试不同的 skill_key
const skillKeys = [
  'stock-scoring-analysis', 
  'financial-analysis', 
  'a-stock-analysis', 
  'prana-stock', 
  'stock-analysis',
  'financial-analysis-cn',
  'a-stock-financial',
  'prana-skill',
  'prana-stock-scoring',
  'investment-advisor',
  'stock-advisor',
  encodeURIComponent('A股财务分析助手'),
  'gupiao-fenxi',
  'maotai-analysis',
  'kweichow-moutai'
];

function trySkillKey(index) {
  if (index >= skillKeys.length) {
    console.log('\nAll skill keys failed');
    process.exit(1);
    return;
  }
  
  const skillKey = skillKeys[index];
  const postData = JSON.stringify({
    request_id: requestId,
    skill_key: skillKey,
    question: QUESTION,
    ...(threadId && { thread_id: threadId })
  });

  const options = {
    hostname: 'claw-uat.ebonex.io',
    port: 443,
    path: '/api/claw/agent-run',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(postData),
      'x-api-key': API_KEY
    }
  };

  console.log(`\nTrying skill_key: ${skillKey}`);

  const req = https.request(options, (res) => {
    let data = '';
    
    res.on('data', (chunk) => {
      data += chunk;
    });
    
    res.on('end', () => {
      try {
        const result = JSON.parse(data);
        if (result.code === 404 || (result.detail && result.detail[0] && result.detail[0].type === 'missing')) {
          console.log(`  -> Failed: ${result.message || JSON.stringify(result.detail)}`);
          trySkillKey(index + 1);
        } else {
          console.log('  -> Success!');
          console.log(JSON.stringify(result, null, 2));
          
          // 提取并保存 thread_id
          if (result.data && result.data.thread_id) {
            fs.writeFileSync(threadFile, result.data.thread_id, 'utf-8');
            console.log('\nThread ID saved:', result.data.thread_id);
          }
          
          // 输出分析结果
          if (result.data && result.data.content) {
            console.log('\n=== 分析结果 ===');
            console.log(result.data.content);
          }
        }
      } catch (e) {
        console.error('Failed to parse response:', e.message);
        console.log('Raw response:', data);
        trySkillKey(index + 1);
      }
    });
  });

  req.on('error', (e) => {
    console.error('Request failed:', e.message);
    trySkillKey(index + 1);
  });

  req.write(postData);
  req.end();
}

trySkillKey(0);
