const express = require('express');
const cors = require('cors');
const multer = require('multer');
const ffmpeg = require('fluent-ffmpeg');
const path = require('path');
const fs = require('fs');

const app = express();
const port = process.env.PORT || 3000;

// Cấu hình thư mục lưu trữ
const UPLOAD_DIR = path.join(__dirname, 'uploads');
const PUBLIC_DIR = path.join(__dirname, 'public');
const VIDEO_DIR = path.join(PUBLIC_DIR, 'videos');

// Tạo thư mục nếu chưa tồn tại
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR);
if (!fs.existsSync(VIDEO_DIR)) fs.mkdirSync(VIDEO_DIR, { recursive: true });

app.use(cors());
app.use(express.static('public')); // Phục vụ file tĩnh (index.html, videos...)

// Cấu hình Multer để nhận file upload
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, UPLOAD_DIR)
    },
    filename: function (req, file, cb) {
        // Đặt tên tạm thời là timestamp.webm
        cb(null, Date.now() + '.webm')
    }
});
const upload = multer({ storage: storage });

// === API: NHẬN FILE VÀ CHUYỂN ĐỔI ===
app.post('/api/convert', upload.single('video'), (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: 'Không tìm thấy file video.' });
    }

    const inputPath = req.file.path;
    const outputFilename = `video_${Date.now()}.mp4`;
    const outputPath = path.join(VIDEO_DIR, outputFilename);

    console.log(`[INFO] Bắt đầu chuyển đổi: ${inputPath}`);

    ffmpeg(inputPath)
        .output(outputPath)
        .videoCodec('libx264') 
        .audioCodec('aac')
        .audioBitrate('128k') // Đảm bảo âm thanh rõ ràng
        .outputOptions([
            // 1. Cố định 30 khung hình/giây (Quan trọng để hết giật)
            '-r 30', 

            // 2. Resize về chuẩn HD 720p
            // scale=-2:720 nghĩa là: Chiều cao 720px, chiều rộng tự tính theo tỷ lệ (và chia hết cho 2)
            '-vf scale=-2:720', 

            // 3. Preset: dùng 'veryfast' thay vì 'ultrafast' để nén tốt hơn, file nhẹ hơn, ít lỗi playback
            '-preset veryfast', 

            // 4. CRF 23: Chất lượng hình ảnh chuẩn (càng thấp càng nét, 23 là mức cân bằng)
            '-crf 23', 

            // 5. Tối ưu hóa cho web/mobile
            '-movflags +faststart', 
            '-pix_fmt yuv420p',
            '-profile:v main',
            '-level 3.1'
        ])
        .on('end', () => {
            console.log(`[SUCCESS] Đã tạo file: ${outputFilename}`);
            
            // Xóa file gốc (.webm) để tiết kiệm dung lượng server
            fs.unlink(inputPath, (err) => {
                if (err) console.error('Lỗi xóa file tạm:', err);
            });

            // Trả về đường dẫn file MP4
            res.json({ 
                success: true, 
                url: `/videos/${outputFilename}` 
            });
        })
        .on('error', (err) => {
            console.error('[ERROR] Lỗi FFmpeg:', err);
            res.status(500).json({ error: 'Lỗi trong quá trình chuyển đổi video.' });
        })
        .run();
});

// Route chính
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(port, () => {
    console.log(`Server Armbian đang chạy tại cổng ${port}`);
});
