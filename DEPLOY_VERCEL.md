# Deploy eureka_crawl lên Vercel

Ứng dụng dùng một project Vercel: giao diện tĩnh và hai Node.js Functions. Không cần Render, database hay biến môi trường cho chức năng hiện tại.

## 1. Import repository

1. Đăng nhập [Vercel](https://vercel.com/new).
2. Chọn **Add New → Project**, kết nối GitHub nếu chưa có.
3. Import repository **hnaduc2005/eureka_crawl**.
4. Trong **Root Directory**, nhấn **Edit** và chọn **vote-dashboard**.
5. Chọn **Framework Preset: Other**.

Vercel đọc cấu hình trong [`vote-dashboard/vercel.json`](vote-dashboard/vercel.json). Root Directory phải trỏ đến thư mục này để nhận đúng `package.json`, `api/` và cấu hình build. [Tài liệu Root Directory và build](https://vercel.com/docs/builds/configure-a-build).

## 2. Kiểm tra cấu hình

| Mục | Giá trị |
| --- | --- |
| Repository | `hnaduc2005/eureka_crawl` |
| Production Branch | `main` |
| Root Directory | **`vote-dashboard`** |
| Framework Preset | **Other** |
| Build Command | **`npm run build:vercel`** |
| Output Directory | **`public`** |
| Install Command | Theo `vercel.json`: bỏ qua bước cài đặt cho build, vì không có dependencies |
| Node.js | **22.x**, đã khai báo trong `package.json` |
| Environment Variables | **Để trống** |
| Fluid compute | Đã bật bằng `fluid: true` |
| Function max duration | Đã cấu hình **300 giây** |

Nếu giao diện chưa hiển thị Build Command hoặc Output Directory, có thể bật Override và điền đúng bảng trên. Các giá trị trong `vercel.json` được dùng cho lần triển khai. Cấu hình 300 giây sử dụng Fluid compute, nằm trong giới hạn hiện tại của gói Hobby. [Cấu hình Vercel](https://vercel.com/docs/project-configuration/vercel-json), [giới hạn thời gian](https://vercel.com/docs/functions/configuring-functions/duration).

Không thêm `PORT`, `API_KEY`, `DATABASE_URL` hay `TOKEN`. Trang nguồn dùng API công khai. `PORT` chỉ dùng khi chạy máy chủ localhost.

## 3. Deploy và kiểm tra

1. Nhấn **Deploy**, đợi deployment chuyển sang **Ready**.
2. Mở domain do Vercel cấp; dashboard sẽ tự lấy dữ liệu lần đầu.
3. Kiểm tra các đường dẫn trên cùng domain:

| Đường dẫn | Kết quả mong đợi |
| --- | --- |
| `/` | Dashboard tiếng Việt |
| `/favicon.svg` | Biểu tượng ứng dụng |
| `/api/competitions` | JSON danh sách cuộc thi |
| `/api/snapshot?competition=eureka-2026&refresh=1` | JSON toàn bộ đề tài, lĩnh vực, số phiếu và thời điểm lấy dữ liệu |

4. Trong dashboard, thử sắp xếp số phiếu hai chiều, lọc lĩnh vực và tìm mã đề tài.
5. Nhấn **Cập nhật dữ liệu** sau khi hết thời gian chờ 10 giây, kiểm tra thời điểm cập nhật thay đổi. Thử xuất CSV nếu trình duyệt cho phép tải file.

Hai endpoint `api/competitions.js` và `api/snapshot.js` dùng giao diện Web Standard `Request`/`Response` của [Vercel Node.js Functions](https://vercel.com/docs/functions/runtimes/node-js). Không cần chạy `npm start` trên Vercel.

Nếu đã tạo project từ bản repo cũ: vào **Settings → Build and Deployment**, sửa Root Directory và kiểm tra các giá trị trên; sau đó vào **Deployments → Redeploy** deployment thuộc nhánh `main`. Khi chọn commit để triển khai, dùng commit mới nhất có `vote-dashboard/vercel.json` và thư mục `vote-dashboard/api`.

## 4. Khi cập nhật mã nguồn

Project được kết nối GitHub sẽ triển khai lại theo cấu hình Git của Vercel khi có commit mới trên nhánh production. Xác nhận **Production Branch = main** trong cấu hình project. [Tích hợp Git của Vercel](https://vercel.com/docs/git).

Để kiểm tra trước khi đẩy code:

```powershell
cd vote-dashboard
npm test
npm run build:vercel
```

Build tạo `public/index.html` và `public/favicon.svg`; hai API được Vercel đóng gói từ thư mục `api/`. Build không gọi trang nguồn nên vẫn hoàn thành khi trang bình chọn tạm ngừng hoạt động.

## Xử lý lỗi thường gặp

| Hiện tượng | Kiểm tra |
| --- | --- |
| 404 ở trang chủ hoặc API | Root Directory phải là `vote-dashboard`; dùng commit mới nhất; Framework là Other; không thêm rewrite mọi đường dẫn về `index.html` |
| Không tìm thấy Output Directory | Build Command phải là `npm run build:vercel`, Output Directory là `public`, không dùng `dist` |
| API trả JSON báo không kết nối được trang bình chọn | Trang nguồn đang lỗi hoặc không truy cập được từ hạ tầng Vercel; kiểm tra trang nguồn, thử cập nhật lại và xem Runtime Logs |
| API trả 429 | Trang nguồn đang giới hạn truy cập; chờ rồi thử lại |
| Function timeout | Kiểm tra Fluid compute, thời gian 300 giây và Runtime Logs; trang nguồn có thể phản hồi chậm |

Cache phía server chỉ tồn tại trong bộ nhớ từng instance, có thể mất khi Vercel khởi động lại hoặc mở thêm instance. Nút cập nhật có thời gian chờ ở trình duyệt; đây không phải bộ giới hạn truy cập chung cho mọi người dùng. Bản dữ liệu gần nhất được lưu trong từng trình duyệt. Ứng dụng chưa lưu lịch sử dài hạn hoặc tự crawl khi không có người mở trang.
