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
