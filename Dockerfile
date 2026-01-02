# Bắt đầu từ một môi trường Node.js phiên bản 18
FROM node:18-slim

# Cập nhật danh sách gói và cài đặt FFmpeg
# RUN là lệnh để thực thi trên dòng lệnh của máy chủ
RUN apt-get update && apt-get install -y ffmpeg && \
    # Xóa cache để giữ cho image nhẹ hơn
    rm -rf /var/lib/apt/lists/*

# Tạo thư mục làm việc cho ứng dụng bên trong máy chủ ảo
WORKDIR /usr/src/app

# Sao chép các file quản lý thư viện vào trước
COPY package*.json ./

# Chạy lệnh npm install để cài đặt các thư viện (express, multer...)
RUN npm install

# Sao chép toàn bộ mã nguồn còn lại của bạn vào
COPY . .

# Mở cổng 3000 để bên ngoài có thể truy cập
EXPOSE 3000

# Lệnh để khởi động ứng dụng khi máy chủ chạy
CMD [ "node", "server.js" ]