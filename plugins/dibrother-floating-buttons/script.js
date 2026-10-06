jQuery(document).ready(function($) {
    // Lấy nút scroll-to-top
    var scrollTopButton = $('#fab-scroll-top');

    // Kiểm tra khi cuộn trang
    $(window).scroll(function() {
        if ($(this).scrollTop() > 200) { // Nếu cuộn xuống hơn 200px
            scrollTopButton.fadeIn(); // Hiện nút
        } else {
            scrollTopButton.fadeOut(); // Ẩn nút
        }
    });

    // Xử lý khi bấm vào nút
    scrollTopButton.click(function(e) {
        e.preventDefault(); // Ngăn hành vi mặc định của thẻ a
        $('html, body').animate({
            scrollTop: 0
        }, 500); // Cuộn lên đầu trang trong 0.5 giây
        return false;
    });
});
