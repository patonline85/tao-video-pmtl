const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();
const port = process.env.PORT || 3000;

app.use(cors());

// --- QUAN TRỌNG: Cấu hình Header cho FFmpeg.wasm ---
// Bắt buộc phải có để trình duyệt cho phép dùng SharedArrayBuffer (đa luồng)
app.use((req, res, next) => {
    res.header("Cross-Origin-Opener-Policy", "same-origin");
    res.header("Cross-Origin-Embedder-Policy", "require-corp");
    next();
});

// Phục vụ các file tĩnh (index.html, js, css, images) trong thư mục public
app.use(express.static('public'));

// Route dự phòng: Luôn trả về index.html nếu người dùng vào đường dẫn gốc
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Khởi động server
app.listen(port, () => {
    console.log(`Server Armbian (Static Mode) đang chạy tại cổng ${port}`);
    console.log(`- Chế độ: Client-Side Rendering (FFmpeg.wasm)`);
});
