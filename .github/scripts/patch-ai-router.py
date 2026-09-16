from pathlib import Path

p = Path('server.js')
s = p.read_text()

s = s.replace("const { GoogleGenerativeAI } = require('@google/generative-ai');\n", "const aiRouter = require('./ai-router');\n", 1)

old_init = '''// ⭐ 初始化 Gemini 2.5 模型 (保留用於生成文字)\nconst genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);\nconst model = genAI.getGenerativeModel({ \n    model: \"gemini-3.5-flash-lite\", \n    generationConfig: { responseMimeType: \"application/json\" }\n});\n\n'''
if old_init not in s:
    raise SystemExit('Gemini init block not found')
s = s.replace(old_init, '', 1)

root_route = '''app.get('/', (req, res) => {\n    res.sendFile(path.join(__dirname, 'public', 'index.html'));\n});\n'''
status_route = root_route + '''\n// 僅回傳已配置 provider 的名稱與模型，不暴露 API key。\napp.get('/api/ai-status', (req, res) => {\n    const providers = aiRouter.getStatus();\n    res.json({\n        strategy: process.env.AI_PROVIDER_STRATEGY || 'round-robin',\n        count: providers.length,\n        providers\n    });\n});\n'''
if root_route not in s:
    raise SystemExit('root route marker not found')
s = s.replace(root_route, status_route, 1)

old_analyze = '''        const result = await model.generateContent(prompt);\n        const response = await result.response;\n        let jsonText = response.text().replace(/```json/g, '').replace(/```/g, '').trim();\n        const parsed = JSON.parse(jsonText);\n        res.json({ subjects: parsed.subjects });\n'''
new_analyze = '''        const routed = await aiRouter.generateJSON(prompt);\n        res.json({ subjects: routed.data.subjects, provider: routed.provider });\n'''
if old_analyze not in s:
    raise SystemExit('analyze model block not found')
s = s.replace(old_analyze, new_analyze, 1)

s = s.replace('你是由 Google 開發的 AI 教育專家，請生成一道高品質的「單選題」。', '你是一名 AI 教育專家，請生成一道高品質的「單選題」。', 1)

old_gen = '''            const genResult = await model.generateContent(generationPrompt);\n            const rawText = genResult.response.text();\n            \n            // 使用正則表達式，安全提取大括號內的 JSON 內容\n            const jsonMatch = rawText.match(/\\{[\\s\\S]*\\}/);\n            if (!jsonMatch) {\n                throw new Error(\"AI 回應中未找到 JSON 結構\");\n            }\n            \n            const parsed = JSON.parse(jsonMatch[0]);\n            if(!parsed.sub_topic) parsed.sub_topic = targetTopic;\n            if(!parsed.subject) parsed.subject = subject;\n\n            return res.json({ text: JSON.stringify(parsed) });\n'''
new_gen = '''            const routed = await aiRouter.generateJSON(generationPrompt);\n            const parsed = routed.data;\n            if(!parsed.sub_topic) parsed.sub_topic = targetTopic;\n            if(!parsed.subject) parsed.subject = subject;\n\n            return res.json({ text: JSON.stringify(parsed), provider: routed.provider });\n'''
if old_gen not in s:
    raise SystemExit('generate quiz block not found')
s = s.replace(old_gen, new_gen, 1)

old_report = '''        const result = await model.generateContent(prompt);\n        const responseText = result.response.text().replace(/```json/g, '').replace(/```/g, '').trim();\n        const json = JSON.parse(responseText);\n        res.json(json);\n'''
new_report = '''        const routed = await aiRouter.generateJSON(prompt);\n        res.json({ ...routed.data, provider: routed.provider });\n'''
if old_report not in s:
    raise SystemExit('verify-report block not found')
s = s.replace(old_report, new_report, 1)

p.write_text(s)
