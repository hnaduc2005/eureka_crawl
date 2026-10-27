# Euréka · Dashboard theo dõi bình chọn

Crawler và dashboard lấy số phiếu công khai từ https://binhchon.khoahoctre.com.vn/.

## Chạy tại máy

Cần Node.js 22 trở lên, không cần cài thêm thư viện.

```powershell
cd C:\Users\Admin\Documents\ChatGPT\tool_crawl\vote-dashboard
npm start
```

Mở http://127.0.0.1:8787/. Hoặc chạy file `run-dashboard.cmd` ở thư mục cha. Để dừng, nhấn Ctrl+C trong cửa sổ terminal. Đặt biến môi trường `PORT` nếu cổng 8787 đang được sử dụng.

## Chức năng

- Lấy toàn bộ trang đề tài và kiểm tra số bản ghi, mã đề tài trùng, số phiếu, phân trang.
- Sắp xếp theo số phiếu tăng/giảm, mã hoặc tên. Có thể nhấn tiêu đề cột BÌNH CHỌN để đảo chiều.
- Tìm tên, mã, tác giả (hỗ trợ tìm không dấu), lọc lĩnh vực và phân trang 25 đề tài.
- Thống kê toàn cuộc thi, thứ hạng có xử lý bằng phiếu, biểu đồ 5 đề tài cao nhất trong danh sách đang lọc.
- Nút **Cập nhật dữ liệu** lấy dữ liệu mới. Giới hạn giữa các lần cập nhật thành công là 10 giây. Dữ liệu không tự cập nhật nền.
- Khi cập nhật lỗi, giữ dữ liệu hoàn chỉnh gần nhất trong trang. Trình duyệt lưu bản thành công gần nhất để phục hồi khi mở lại và kết nối được danh sách cuộc thi.
- Xuất CSV UTF-8 có BOM, tương thích tiếng Việt trong Excel; xuất toàn bộ kết quả đang lọc theo thứ tự đang chọn, bao gồm thời điểm cập nhật.

## Chạy crawler riêng

```powershell
npm run crawl
npm run crawl -- eureka-2026
```

Lưu `data/eureka-2026.json` và `data/eureka-2026.csv`. Chỉ gọi API GET công khai; không cần tài khoản. Mỗi lượt lấy danh sách lĩnh vực và các trang đề tài với tối đa 3 request phân trang đồng thời. `voteCount: null` được giữ là chưa công khai, không đổi thành 0.

## Kiểm chứng

```powershell
npm test
npm run build
npm run validate
```

Backend nằm trong `worker/index.js`, dùng chung cho máy chủ Node cục bộ và Cloudflare Worker. HTML/CSS/JS được nhúng trực tiếp, không dùng CDN. Bản build gồm `dist/server/index.js` và `.openai/hosting.json`.

Nguồn API đã xác minh ngày 27/10/2026: `GET /api/competitions?all=true`, `GET /api/competitions/{id}`, `GET /api/c/{id}/categories`, `GET /api/c/{id}/entries?page=1&pageSize=100`. Trang nguồn giới hạn 100 đề tài/trang. Số phiếu được đọc ở các thời điểm khác nhau trong quá trình lấy dữ liệu, không phải ảnh chụp đồng thời tuyệt đối.
