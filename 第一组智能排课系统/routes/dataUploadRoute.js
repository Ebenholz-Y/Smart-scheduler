// routes/dataUploadRoute.js
const express = require('express');
const router = express.Router();
const mysql = require('mysql2/promise');
const dbConfig = require('../config/dbConfig');

// POST /api/upload/courses
router.post('/courses', async (req, res) => {
    const courses = req.body;
    if (!Array.isArray(courses) || courses.length === 0) {
        return res.status(400).json({ error: '课程数据必须是非空数组' });
    }
    let conn;
    try {
        conn = await mysql.createConnection(dbConfig);
        await conn.execute('USE course_schedule');
        await conn.execute('DELETE FROM courses'); // 清空旧数据（可选）
        const values = courses.map(c => [c.name, c.students, c.teacher, c.location]);
        await conn.execute('INSERT INTO courses (name, students, teacher, location) VALUES ?', [values]);
        res.json({ success: true, message: `成功上传 ${courses.length} 门课程` });
    } catch (err) {
        console.error('上传课程失败:', err);
        res.status(500).json({ error: '服务器内部错误', details: err.message });
    } finally {
        if (conn) await conn.end();
    }
});

// POST /api/upload/classrooms
router.post('/classrooms', async (req, res) => {
    const rooms = req.body;
    if (!Array.isArray(rooms) || rooms.length === 0) {
        return res.status(400).json({ error: '教室数据必须是非空数组' });
    }
    let conn;
    try {
        conn = await mysql.createConnection(dbConfig);
        await conn.execute('USE course_schedule');
        await conn.execute('DELETE FROM classrooms'); // 清空旧数据（可选）
        const values = rooms.map(r => [r.id, r.capacity]);
        await conn.execute('INSERT INTO classrooms (id, capacity) VALUES ?', [values]);
        res.json({ success: true, message: `成功上传 ${rooms.length} 个教室` });
    } catch (err) {
        console.error('上传教室失败:', err);
        res.status(500).json({ error: '服务器内部错误', details: err.message });
    } finally {
        if (conn) await conn.end();
    }
});

module.exports = router;