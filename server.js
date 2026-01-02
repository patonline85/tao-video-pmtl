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
        .audioBitrate('128k') // Tăng chất lượng âm thanh lên 192k
        .outputOptions([
            // 1. Giữ nguyên hoặc giảm FPS (nếu không cần quá mượt thì 24 hoặc 30 là đủ nhẹ)
            '-r 30',
        
            // 2. Độ phân giải: Nếu muốn nhanh nhất thì nên bỏ dòng này để giữ nguyên gốc.
            // Tuy nhiên, nếu bắt buộc phải resize về 720p thì giữ lại.
            '-vf scale=-2:720',
        
            // 3. QUAN TRỌNG NHẤT: Preset
            // Chuyển từ 'slow' sang 'ultrafast' (Siêu nhanh).
            // FFmpeg sẽ bỏ qua các thuật toán nén phức tạp để xuất file ngay lập tức.
            // Nhược điểm: File sẽ nặng hơn khoảng 2-3 lần so với 'slow'.
            '-preset ultrafast',
        
            // 4. Tối ưu độ trễ (Giúp bắt đầu render nhanh hơn)
            '-tune zerolatency',
        
            // 5. CRF (Chất lượng): Tăng lên để giảm gánh nặng cho CPU
            // Tăng từ 18 lên 28.
            // 28 là mức chất lượng trung bình khá, không quá nét nhưng render rất nhẹ.
            '-crf 28',
        
            // 6. Profile: Chuyển về 'baseline'
            // Profile này đơn giản nhất, ít tốn tài nguyên giải mã/mã hóa nhất.
            '-profile:v baseline',
            
            // 7. Các thông số tương thích web (Giữ nguyên)
            '-movflags +faststart',
            '-pix_fmt yuv420p',
            
            // 8. Ép sử dụng đa luồng tối đa (Tận dụng hết các nhân CPU của Armbian)
            '-threads 0' 
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
