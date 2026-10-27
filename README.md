# eureka_crawl

Tool crawl số bình chọn từng đề tài tại [Bình chọn Khoa học trẻ](https://binhchon.khoahoctre.com.vn/), kèm dashboard tiếng Việt.

Chạy **run-dashboard.cmd**, sau đó mở http://127.0.0.1:8787/.

Mã nguồn và hướng dẫn đầy đủ nằm trong [vote-dashboard/README.md](vote-dashboard/README.md).

- Cập nhật dữ liệu bằng nút **Cập nhật dữ liệu**.
- Sắp xếp số bình chọn tăng/giảm, tìm kiếm không dấu và lọc lĩnh vực.
- Thống kê số đề tài, tổng số phiếu, đề tài dẫn đầu và xuất CSV.
- Node.js 22 trở lên, không cần cài thêm thư viện.

```powershell
cd vote-dashboard
npm start
```

Mở http://127.0.0.1:8787/. Dừng máy chủ bằng Ctrl+C.

## Phòng kiểm thử

Mở **Kiểm thử** từ dashboard hoặc `/testing/`. Có thể chạy mô phỏng mẫu ngay, nhập URL môi trường test sau, chọn đề tài, số người dùng/phiếu và dừng lượt chạy. Xem [cách dùng và giao thức kết nối](TEST_ENVIRONMENT.md). Môi trường thật chưa được công bố nên việc kết nối vẫn cần đối chiếu API của môi trường đó.

## Deploy Vercel

Xem [hướng dẫn deploy từng bước](DEPLOY_VERCEL.md).

Import repository vào Vercel, giữ **Root Directory trống hoặc `.`**, **Framework = Other**. Cấu hình build `npm run build:vercel`, output `public`, Node.js `22.x` đã có sẵn. **Environment Variables để trống.** Giao diện và API chạy cùng một project Vercel. Nếu project đã chọn Root Directory là `vote-dashboard`, cấu hình đó cũng được hỗ trợ.
