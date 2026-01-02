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

// === QUẢN LÝ TRẠNG THÁI JOB (CƠ CHẾ BẤT ĐỒNG BỘ) ===
// Lưu trạng thái: { 'video_123.mp4': 'processing', 'video_456.mp4': 'done' }
const conversionJobs = {};

// === API 1: NHẬN FILE VÀ CHUYỂN ĐỔI (TRẢ VỀ NGAY) ===
app.post('/api/convert', upload.single('video'), (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: 'Không tìm thấy file video.' });
    }

    const inputPath = req.file.path;
    const outputFilename = `video_${Date.now()}.mp4`;
    const outputPath = path.join(VIDEO_DIR, outputFilename);

    // 1. Đánh dấu trạng thái đang xử lý
    conversionJobs[outputFilename] = 'processing';

    console.log(`[INFO] Đã nhận job: ${outputFilename}. Đang xử lý ngầm...`);

    // 2. Chạy FFmpeg NGẦM (Không chờ kết quả để response)
    ffmpeg(inputPath)
        .output(outputPath)
        .videoCodec('libx264')
        .audioCodec('aac')
        .audioBitrate('128k') 
        .outputOptions([
            // 1. Cố định 30 FPS để mượt mà
            '-r 30',

            // 2. Resize về HD 720p (nhẹ cho server Armbian)
            '-vf scale=-2:720',

            // 3. Preset veryfast: Nhanh hơn ultrafast một chút nhưng ổn định hơn
            '-preset veryfast',

            // 4. CRF 28: Giảm chất lượng một chút để render cực nhanh (tránh timeout)
            '-crf 28',

            // 5. Tối ưu playback
            '-movflags +faststart',
            '-pix_fmt yuv420p',
            '-profile:v main',
            '-level 3.1'
        ])
        .on('end', () => {
            console.log(`[SUCCESS] Hoàn tất job: ${outputFilename}`);
            
            // Cập nhật trạng thái xong
            conversionJobs[outputFilename] = 'done';

            // Xóa file gốc (.webm)
            fs.unlink(inputPath, (err) => {
                if (err) console.error('Lỗi xóa file tạm:', err);
            });
        })
        .on('error', (err) => {
            console.error('[ERROR] Job thất bại:', err);
            conversionJobs[outputFilename] = 'error';
        })
        .run();

    // 3. Phản hồi ngay lập tức cho Client
    res.json({ 
        success: true, 
        message: 'Đang xử lý ngầm',
        jobId: outputFilename 
    });
});

// === API 2: CLIENT HỎI THĂM TRẠNG THÁI (POLLING) ===
app.get('/api/status/:filename', (req, res) => {
    const filename = req.params.filename;
    const status = conversionJobs[filename];

    if (!status) {
        return res.status(404).json({ status: 'not_found' });
    }

    if (status === 'done') {
        // Xóa khỏi danh sách theo dõi để giải phóng bộ nhớ
        delete conversionJobs[filename];
        return res.json({ status: 'done', url: `/videos/${filename}` });
    }

    // Trả về: 'processing' hoặc 'error'
    res.json({ status: status });
});

// Route chính
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// === TỰ ĐỘNG DỌN DẸP FILE CŨ ===
const MAX_AGE = 60 * 60 * 1000; // 60 phút
const CLEANUP_INTERVAL = 30 * 60 * 1000; // 30 phút

setInterval(() => {
    fs.readdir(VIDEO_DIR, (err, files) => {
        if (err) {
            console.error('[CLEANUP] Lỗi đọc thư mục video:', err);
            return;
        }

        const now = Date.now();
        files.forEach(file => {
            if (!file.endsWith('.mp4')) return;

            const filePath = path.join(VIDEO_DIR, file);
            fs.stat(filePath, (err, stats) => {
                if (err) return;
                if (now - stats.mtimeMs > MAX_AGE) {
                    fs.unlink(filePath, (err) => {
                        if (err) console.error(`[CLEANUP] Lỗi xóa file ${file}:`, err);
                        else console.log(`[CLEANUP] Đã xóa file cũ: ${file}`);
                    });
                }
            });
        });
    });
}, CLEANUP_INTERVAL);

const server = app.listen(port, () => {
    console.log(`Server Armbian đang chạy tại cổng ${port}`);
});

// Vẫn giữ timeout cao để dự phòng
server.setTimeout(10 * 60 * 1000);
