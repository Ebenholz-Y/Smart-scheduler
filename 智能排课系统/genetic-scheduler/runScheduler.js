const fs = require('fs');
const path = require('path');
const { GeneticScheduler } = require('./scheduler');

async function main() {
    console.log('📂 正在读取输入数据...');

    const dataDir = path.join(__dirname, 'data');
    const outputDir = path.join(__dirname, 'output');
    if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir);

    const courses = JSON.parse(fs.readFileSync(path.join(dataDir, 'courses.json'), 'utf-8'));
    const classrooms = JSON.parse(fs.readFileSync(path.join(dataDir, 'classrooms.json'), 'utf-8'));

    console.log(`📚 课程数量: ${courses.length}`);
    console.log(`🏫 教室数量: ${classrooms.length}`);

    const scheduler = new GeneticScheduler({
        populationSize: 60,
        generations: 150,
        mutationRate: 0.12,
        crossoverRate: 0.85
    });

    console.log('🧬 正在运行遗传算法排课...');
    const result = await scheduler.run(courses, classrooms);

    const outputPath = path.join(outputDir, 'schedule_output.json');
    fs.writeFileSync(outputPath, JSON.stringify(result, null, 2), 'utf-8');

    console.log(`✅ 排课完成！结果已保存至: ${outputPath}`);
    console.log(`🎯 最佳适应度: ${result.fitness}`);
    console.log(`📅 安排课程数: ${result.schedule.length}`);
}

main().catch(err => {
    console.error('❌ 运行出错:', err);
});