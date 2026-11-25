# NTH Video
Web quản lý video tiếng Việt, frontend HTML/CSS/JS và API Node.js/Express triển khai trên Render. Supabase Auth + Postgres lưu tài khoản và metadata. Video được lưu thành các file .part 20 MiB trong folder của repository GitHub riêng tư.

## Tính năng
- Đăng ký email/mật khẩu và vào thư viện ngay, đăng nhập, đăng xuất và làm mới phiên qua Supabase.
- Thư viện riêng theo tài khoản; API xác thực JWT bằng Supabase getUser, database bật RLS.
- Kéo thả/chọn nhiều video, tiến trình tải, tạo và đổi tên thư mục, đổi tên hiển thị video.
- Chia sẻ từng video hoặc cả thư mục bằng link xem và tải bản gốc, kể cả 4K. Chủ video hoặc thư mục có thể thu hồi link.
- Tìm tên, lọc khoảng ngày upload theo múi giờ thiết bị, sắp xếp tên/mới/cũ.
- Xem chất lượng gốc, tua bằng HTTP Range; tải xuống đúng byte gốc, không nén lại.
- Video lớn chia thành phần 20 MiB, proxy ghép luồng từ GitHub. Giới hạn upload mặc định 2048 MiB/file.
- MP4, WebM, MOV, MKV được nhận; khả năng phát phụ thuộc codec trình duyệt. Trình phát hỗ trợ bản gốc 4K (ví dụ 3840 × 2160) khi trình duyệt giải mã được video. Trình phát hiển thị kích thước khung hình thực tế, có nút toàn màn hình và giữ nguyên độ phân giải của file gốc.

## 1. Chuẩn bị Supabase
1. Mở SQL Editor trong project kqmvhtuhneklsgwfaeds, chạy toàn bộ supabase/schema.sql một lần.
   Nếu đã chạy schema cũ, chạy supabase/add-video-sharing.sql để chia sẻ video và supabase/add-folder-sharing.sql để chia sẻ thư mục.
2. Authentication > Sign In / Providers: bật Email và Allow new users to sign up, tắt Confirm email để đăng ký xong vào thư viện ngay.
3. Authentication > URL Configuration: đặt Site URL thành URL Render sau deploy và thêm URL đó trong Redirect URLs; local dùng http://localhost:3000.
4. Settings > API keys: lấy backend secret key (sb_secret_...) hoặc legacy service_role key. Điền vào SUPABASE_SERVICE_ROLE_KEY, tuyệt đối không đưa vào frontend/Git.
5. Publishable key và project URL bạn cung cấp đã có trong .env.example và render.yaml. Khóa public không thay thế được khóa backend để ghi metadata.

## 2. Chuẩn bị repository lưu video
1. Tạo một repo GitHub PRIVATE, khởi tạo README để có branch main.
2. Tạo fine-grained personal access token chỉ cho repo này, quyền Repository contents: Read and write.
3. Điền GITHUB_OWNER, GITHUB_REPO, GITHUB_BRANCH (mặc định main), GITHUB_TOKEN.
4. Repo lưu video nên tách khỏi repo mã nguồn để commit video không kích hoạt deploy Render.
5. Không bật Git LFS cho folder video. API ghi Git blobs bình thường, được chia nhỏ dưới giới hạn file của GitHub.
6. Cấu trúc: videos/<user_id>/<video_id>/00000.part, 00001.part... Metadata giữ SHA từng phần ở Supabase.
7. Chạy một instance API duy nhất: hàng đợi ghi GitHub nằm trong process để tránh xung đột commit. Nếu cần scale phải dùng hàng đợi/lock dùng chung.

Module server/github.js là phần code đẩy file lên GitHub riêng. putChunk(path, bytes) ghi file bằng GitHub Contents API, getChunk(sha, signal) đọc nội dung private qua backend. Không trả token hay URL private GitHub cho browser.

## 3. Chạy local (Node 22+)
~~~powershell
npm ci
Copy-Item .env.example .env
# Điền các giá trị backend còn trống trong .env
npm start
~~~
Mở http://localhost:3000. Frontend và API được phục vụ cùng origin; không cần build frontend. .env không được commit.

## 4. Deploy API + web lên Render
1. Đẩy mã nguồn này vào repository mã nguồn của bạn.
2. Render > New > Blueprint, chọn repo; render.yaml tạo Web Service. Hoặc tạo Node Web Service: Build Command npm ci; Start Command npm start; Health Check /api/health.
3. Điền SUPABASE_SERVICE_ROLE_KEY, GITHUB_TOKEN, GITHUB_OWNER, GITHUB_REPO. MEDIA_SIGNING_SECRET được Blueprint sinh tự động; nếu tạo thủ công dùng chuỗi ngẫu nhiên ít nhất 32 ký tự.
4. APP_ORIGIN đặt URL Render chính xác, ví dụ https://nth-video-api.onrender.com. Không có dấu / cuối URL. Nếu frontend riêng, thêm origin frontend, phân cách bằng dấu phẩy.
5. Deploy, rồi cập nhật Supabase Site URL/Redirect URLs theo bước 1.
6. Mở URL Render: web và API dùng chung dịch vụ. API có thể gọi độc lập bằng Authorization: Bearer <Supabase access_token>.

Blueprint chọn plan starter; có thể đổi plan. Render cần dung lượng đĩa tạm đủ cho tối đa 2 upload đang chạy. File tạm xóa khi hoàn tất/lỗi, không dùng filesystem Render làm nơi lưu video dài hạn.

## API
| Method | Path | Nội dung |
| --- | --- | --- |
| GET | /api/health | Health check |
| GET | /api/config | Cấu hình public cho frontend |
| GET | /api/library | Danh sách folder và metadata thuộc user |
| POST | /api/folders | JSON {name} |
| PATCH | /api/folders/:id | JSON {name} |
| PATCH | /api/videos/:id | JSON {name} |
| POST | /api/videos | multipart: video; folderId, width, height, duration tùy chọn |
| GET | /api/videos/:id/link | Cấp URL phát/tải có chữ ký, hiệu lực 6 giờ |
| GET | /api/media/:id?... | Luồng video; hỗ trợ Range, &download=1 |
| GET / POST / DELETE | /api/videos/:id/share | Chủ video xem, tạo hoặc thu hồi link chia sẻ |
| GET / POST / DELETE | /api/folders/:id/share | Chủ thư mục xem, tạo hoặc thu hồi link chia sẻ |
| GET | /watch#TOKEN | Trang xem video được chia sẻ |
| GET | /watch/folder#TOKEN | Trang xem các video đã tải xong trong thư mục |
| GET | /api/shared-folders/:token | Tên thư mục và danh sách video |
| GET | /api/shared-folders/:token/videos/:id/media | Phát hoặc tải video thuộc thư mục bằng ?download=1 |
| GET | /api/shared/:token | Tên video được chia sẻ |
| GET | /api/shared/:token/media | Luồng video được chia sẻ, hỗ trợ Range và tải bản gốc bằng ?download=1 |

API thư viện và quản lý chia sẻ yêu cầu Supabase access token. Người nhận có thể xem và tải bản gốc mà không đăng nhập. Sau khi chủ video thu hồi link, các yêu cầu mới qua link bị từ chối. Đường dẫn media là bearer link: ai có link có thể dùng trong 6 giờ, kể cả sau khi chủ tài khoản đăng xuất. Link được kiểm tra user sở hữu video, chỉ đọc bản ready. Giữ link riêng tư; mở lại video để cấp link mới nếu hết hạn.

Ví dụ upload từ API khác:
~~~javascript
const form = new FormData();
form.append('video', videoBlob, 'clip.mp4');
const response = await fetch('https://YOUR-API.onrender.com/api/videos', {
  method: 'POST',
  headers: { Authorization: 'Bearer ' + supabaseAccessToken },
  body: form
});
const result = await response.json();
~~~

## Kiểm tra
~~~powershell
npm run check
npm test
~~~
Tests kiểm tra HMAC, hết hạn, chống truy cập chéo tài khoản, HTTP 401/403/404/416, full stream, range/suffix xuyên phần, download và phục vụ frontend. Tests API dùng mock Supabase/GitHub; không thay thế kiểm tra upload thật với tài khoản của bạn.

## Giới hạn vận hành
- GitHub không phải dịch vụ streaming/CDN; API rate limit, dung lượng repo, băng thông và tốc độ GitHub/Render có thể ảnh hưởng phát, nhất là nhiều người xem.
- Chia file không tránh chính sách/giới hạn tổng dung lượng repo của GitHub. Dùng cho thư viện nhỏ/cá nhân; với quy mô lớn nên chuyển storage video sang R2/S3/Supabase Storage.
- Upload qua đĩa tạm rồi ghi GitHub; chưa có resume upload khi mạng mất/Render restart. Đừng đóng trang trước thông báo hoàn tất.
- Upload lỗi được đánh dấu failed, phần đã ghi vẫn nằm trên GitHub và metadata để kiểm tra thủ công. Restart giữa upload có thể để lại uploading và file tạm. Không có tác vụ dọn orphan tự động.
- Đổi tên chỉ sửa metadata, không di chuyển/đổi tên các .part vật lý. Mỗi user có thư mục một cấp; không có thư mục lồng nhau.
- Không có transcoding/HLS, kiểm tra codec phía server, tạo thumbnail thật, xóa tài khoản hay xóa video. Kích thước/codec hiển thị do trình duyệt đọc, không phải thông tin đã được server kiểm chứng.
- Chưa deploy hoặc chạy SQL trên Supabase thật: cần khóa backend và cấu hình GitHub của chủ tài khoản.
