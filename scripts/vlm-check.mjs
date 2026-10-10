import ZAI from 'z-ai-web-dev-sdk';
import fs from 'fs';

const zai = await (ZAI.default ?? ZAI).create();
const files = ['/tmp/v4-01-start.png', '/tmp/v4-02-y452.png'];
for (const f of files) {
  const b64 = fs.readFileSync(f).toString('base64');
  const res = await zai.chat.completions.create({
    messages: [{
      role: 'user',
      content: [
        { type: 'text', text: '这是等距视角沙盒游戏《人类社会实验室》的截图。请评估：1) 建筑密度是否自然（是否过密堆叠）2) 右下角小地图是否清晰显示局部地图与视口框 3) 画面是否有多文明色标/标签 4) 地形是否有起伏与植被多样性 5) 整体精细度评分(1-10)。请简要分点回答，中文。' },
        { type: 'image_url', image_url: { url: `data:image/png;base64,${b64}` } },
      ],
    }],
    temperature: 0.2,
  });
  console.log(`\n===== ${f} =====\n` + res.choices[0].message.content);
}
