# EduTrack REST API v1

Hợp đồng chính dùng base URL `/api/v1`. Base URL cũ `/v1/api` được giữ tạm
thời như lớp tương thích và không được dùng cho chức năng mới.

## Quy ước

- URL dùng danh từ; module có thể làm namespace như `/chat` và `/calendar`.
- `GET` đọc, `POST` tạo, `PUT` thay thế hoặc thiết lập tài nguyên, `PATCH` cập
  nhật một phần và `DELETE` xóa.
- Phản hồi thành công dùng `success`, `data` và `message` khi cần.
- Phản hồi lỗi dùng `success: false`, `code`, `message` và `fieldErrors` khi lỗi
  gắn với trường nhập liệu.
- Tài nguyên cần đăng nhập nhận token qua cookie HttpOnly và thao tác thay đổi
  dữ liệu phải qua CSRF middleware.

## Tài nguyên chính

| Nhóm | Endpoint chính |
| --- | --- |
| Xác thực | `/auth/registrations`, `/auth/sessions`, `/auth/password-resets` |
| Người dùng hiện tại | `/users/me`, `/users/me/avatar`, `/users/me/sessions` |
| Ghi chú | `/notes`, `/note-tags`, `/note-images`, `/trash/notes` |
| Chia sẻ ghi chú | `/notes/:noteId/collaborators` |
| Chat trực tiếp | `/chat/direct-conversations/:conversationId/messages` |
| Nhóm chat | `/chat/groups`, `/chat/groups/:groupId/messages` |
| Quan hệ bạn bè | `/chat/friendships`, `/chat/friend-requests` |
| Lịch | `/calendar/categories`, `/calendar/events` |
| Thông báo | `/notifications` |

## Chuyển đổi endpoint cũ

Frontend phải sử dụng `/api/v1`. Khi frontend và backend production đã chạy ổn
định cùng phiên bản, xóa `legacyApiRouter`, mount `/v1/api` và rewrite cũ trên
Vercel trong một thay đổi riêng có kiểm thử hồi quy.

## Cấu hình liên quan

- Frontend local: `VITE_API_BASE_URL=http://localhost:8888/api/v1`.
- Google OAuth local: callback `/api/v1/auth/google/callback`; URI trong Google
  Cloud Console phải trùng tuyệt đối với `GOOGLE_CALLBACK_URL`.
- Vercel phải proxy `/api/v1/:path*` sang cùng đường dẫn trên Render.
- Socket.IO hiện vẫn dùng path `/v1/api/socket.io`; đây là transport realtime,
  không thuộc hợp đồng REST và sẽ được chuyển ở một thay đổi realtime riêng.
