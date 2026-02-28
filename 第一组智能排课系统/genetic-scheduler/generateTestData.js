const fs = require('fs');
const path = require('path');

function generateTestData() {
    const teachers = ['张老师', '李老师', '王老师', '赵老师', '刘老师', '陈老师'];
    const courseNames = ['高等数学', '大学英语', '计算机网络', '数据结构', '操作系统', '线性代数', '概率统计', 'C语言程序设计'];
    const roomIds = ['A101', 'A102', 'B201', 'B202', 'C301', 'C302'];

    const courses = [];
    for (let i = 0; i < 12; i++) {
        courses.push({
            id: i + 1,
            name: courseNames[i % courseNames.length] + (i >= courseNames.length ? `(${Math.floor(i / courseNames.length) + 1})` : ''),
            students: Math.floor(Math.random() * 30) + 20,
            teacher: teachers[Math.floor(Math.random() * teachers.length)],
            hours: 3,
            credits: 2,
            location: roomIds[Math.floor(Math.random() * roomIds.length)]
        });
    }

    const classrooms = roomIds.map(id => ({
        id: id,
        capacity: Math.floor(Math.random() * 20) + 30,
        available: [1,2,3,4,5,6,7,8,9,10]
    }));

    const dataDir = path.join(__dirname, 'data');
    if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir);

    fs.writeFileSync(path.join(dataDir, 'courses.json'), JSON.stringify(courses, null, 2), 'utf-8');
    fs.writeFileSync(path.join(dataDir, 'classrooms.json'), JSON.stringify(classrooms, null, 2), 'utf-8');

    console.log('✅ 测试数据已生成到 ./data/ 目录');
}

generateTestData();