# Phòng kiểm thử và URL môi trường test

Trong dashboard, chọn **Kiểm thử** ở thanh trên hoặc mở `/testing/` trên cùng domain. Tính năng gồm nhập URL, chọn đề tài, số người dùng mô phỏng, số phiếu test, nhật ký, báo cáo JSON và nút dừng.

## Dùng ngay với mô phỏng mẫu

1. Chạy dashboard bằng `npm start` từ gốc repo.
2. Mở http://127.0.0.1:8787/testing/.
3. Giữ URL `demo://local` hoặc chọn **Dùng mô phỏng mẫu**.
4. Chọn đề tài, số người dùng và số phiếu. Mỗi người dùng test gửi tối đa một phiếu, nên số phiếu phải nhỏ hơn hoặc bằng số người dùng.
5. Nhấn **Bắt đầu kiểm thử**. Các bộ đếm và nhật ký cập nhật theo từng thao tác.

Bản mẫu tạo danh tính `@example.invalid` trong bộ nhớ trình duyệt. Đây là tài khoản mô phỏng, không phải tài khoản Google. Các lượt mô phỏng độc lập với dữ liệu crawl. Mỗi lần bắt đầu sử dụng một phiên mô phỏng mới.

## Nhập URL do ban tổ chức cấp sau

Nhập URL website test, ví dụ `https://staging.example.org`, rồi nhấn **Kiểm tra kết nối**. URL có thể đổi bất cứ lúc nào khi không có lượt chạy. Khi sửa URL, kết nối cũ được bỏ và cần kiểm tra lại.

Vì URL và cấu trúc môi trường thật chưa được công bố, bản hiện tại chuẩn bị connector theo giao thức `eureka-test-v1` bên dưới. **Không bảo đảm một website bất kỳ chỉ nhập URL là tự đăng nhập/bình chọn được.** Nếu môi trường được cấp chỉ có giao diện web hoặc API khác, cần xem website đó để bổ sung adapter phù hợp. Nếu connector không được hỗ trợ, công cụ báo chưa kết nối và không chạy bước tạo người dùng hay phiếu.

Connector gửi yêu cầu từ trình duyệt trực tiếp đến website test. Không dùng proxy backend, cookie đăng nhập Google, tài khoản Google thật hoặc API phiếu của trang bình chọn đang theo dõi. URL ngoài localhost dùng HTTPS; địa chỉ trang bình chọn thật không được nhận làm môi trường test.

## Giao thức kết nối

Website test cần phục vụ `/api/test-harness`. Những API dưới đây chỉ xử lý tài khoản/phiếu mô phỏng trong dữ liệu kiểm thử riêng.

### 1. Kiểm tra môi trường

`GET /api/test-harness?op=manifest`

```json
{
  "protocol": "eureka-test-v1",
  "environment": "test",
  "isolated": true,
  "simulatedAccounts": true,
  "name": "Môi trường kiểm thử của ban tổ chức",
  "entries": [{ "id": "demo-01", "code": "DEMO-001", "title": "Đề tài thử nghiệm" }],
  "limits": { "maxUsers": 500, "maxVotes": 500, "requestsPerSecond": 5 }
}
```

Chỉ khi dữ liệu manifest hợp lệ, giao diện mới cho bắt đầu lượt test. Mức trần hiện tại là 500 người dùng, 500 phiếu và 5 thao tác/giây; máy chủ có thể công bố giới hạn thấp hơn. Đây là giao thức do tool cung cấp, chưa phải API đã được xác nhận của ban tổ chức.

### 2. Các thao tác test

| Request | JSON gửi lên | JSON trả về |
| --- | --- | --- |
| `POST ?op=create-user` | `runId`, `index` | `id`, `password` của người dùng mô phỏng |
| `POST ?op=login` | `runId`, `userId`, `password` | `token` phiên test |
| `POST ?op=vote` | `runId`, `token`, `entryId`, `requestId` | `accepted` (boolean), tùy chọn `duplicate`, `total` |

`runId` do tool sinh theo dạng `run-<UUID>`. Server cần giới hạn phiên test, giữ mỗi người dùng tối đa một phiếu/đề tài và xử lý `requestId` hoặc phiên để tránh cộng phiếu trùng. Mật khẩu và token test chỉ ở bộ nhớ trong lượt chạy, không có trong báo cáo UI. Công cụ dừng ở lỗi đầu tiên và không tự gửi lại thao tác ghi.

Nếu dashboard và môi trường test khác origin, máy chủ test cần trả CORS cho đúng origin dashboard, hỗ trợ preflight `OPTIONS`, các method `GET, POST` và header `Content-Type`. Công cụ dùng `credentials: omit` và không đi theo redirect. Tham khảo [Fetch và CORS](https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API/Using_Fetch).

Nút **Dừng** hủy yêu cầu phía trình duyệt và chặn các thao tác tiếp theo. Yêu cầu mà máy chủ đã nhận có thể đã được xử lý; kết quả dở dang được giữ trong báo cáo.

## Môi trường HTTP mẫu để kiểm tra kết nối

Tool có server mẫu chỉ lắng nghe tại localhost, không kết nối ra dịch vụ khác:

```powershell
npm run test:environment
```

Giữ dashboard chạy ở cửa sổ khác. Trong Phòng kiểm thử, nhập **http://127.0.0.1:8790** rồi kiểm tra kết nối. Mẫu này dùng tài khoản mô phỏng trong RAM của server, dữ liệu mất khi server dừng.

Mặc định server mẫu cho phép dashboard origin `http://127.0.0.1:8787`. Nếu dùng origin khác, đặt `TEST_DASHBOARD_ORIGIN`; có thể đổi cổng bằng `TEST_ENV_PORT`. Hai biến này chỉ dành cho server test HTTP mẫu, không cần cho crawler hoặc bản mô phỏng trong trình duyệt.

```powershell
$env:TEST_DASHBOARD_ORIGIN = 'http://localhost:8787'
$env:TEST_ENV_PORT = '8790'
npm run test:environment
```

## Kiểm tra mã và build

```powershell
npm test
npm run build:vercel
```

Build tạo `public/testing/index.html`. Cả cấu hình Vercel ở gốc repo và trong `vote-dashboard/` đều có trang kiểm thử. Bản Worker cũ được build thành một file có nhúng trang kiểm thử bằng `cd vote-dashboard; npm run build; npm run validate`.
