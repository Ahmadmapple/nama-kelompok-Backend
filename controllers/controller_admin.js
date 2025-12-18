import sql from "../config/db.js";

export const getAdminStats = async (req, res) => {
  try {
    const [row] = await sql`
      SELECT
        (SELECT COUNT(*)::int FROM pengguna) as users,
        (SELECT COUNT(*)::int FROM data_artikel) as articles,
        (SELECT COUNT(*)::int FROM data_kuis) as quizzes,
        (SELECT COUNT(*)::int FROM data_event) as events
    `;

    res.json({
      stats: {
        users: row?.users ?? 0,
        articles: row?.articles ?? 0,
        quizzes: row?.quizzes ?? 0,
        events: row?.events ?? 0,
      },
    });
  } catch (error) {
    console.error("Error fetching admin stats:", error);
    res.status(500).json({ message: "Gagal mengambil statistik admin" });
  }
};

export const getAllUsers = async (req, res) => {
  try {
    const users = await sql`
      SELECT 
        p.id_pengguna as id,
        p.nama_pengguna as name,
        p.email_pengguna as email,
        p.role_pengguna as role,
        p.foto_pengguna as avatar,
        p.is_verified,
        p.tanggal_bergabung as created_at,
        COALESCE(dp.xp_pengguna, 0) as xp,
        COALESCE(dp.level_pengguna, 0) as level
      FROM pengguna p
      LEFT JOIN data_progres_pengguna dp ON p.id_pengguna = dp.id_pengguna
      ORDER BY p.tanggal_bergabung DESC
    `;

    res.json({ users });
  } catch (error) {
    console.error('Error fetching users:', error);
    res.status(500).json({ message: 'Gagal mengambil data pengguna' });
  }
};

export const getAllArticles = async (req, res) => {
  try {
    const articles = await sql`
      SELECT 
        a.id_artikel as id,
        a.nama_artikel as title,
        a.deskripsi as description,
        a.gambar_artikel as image,
        a.kategori as category,
        a.perkiraan_waktu_menit as duration,
        a.tanggal_publish as created_at,
        p.nama_pengguna as author_name,
        p.foto_pengguna as author_avatar,
        COUNT(DISTINCT al.id_pengguna) as likes_count,
        a.view_artikel as views_count
      FROM data_artikel a
      LEFT JOIN pengguna p ON a.id_pengguna = p.id_pengguna
      LEFT JOIN artikel_likes al ON a.id_artikel = al.id_artikel
      GROUP BY a.id_artikel, p.nama_pengguna, p.foto_pengguna
      ORDER BY a.tanggal_publish DESC
    `;

    res.json({ articles });
  } catch (error) {
    console.error('Error fetching articles:', error);
    res.status(500).json({ message: 'Gagal mengambil data artikel' });
  }
};

export const getAllQuizzes = async (req, res) => {
  try {
    const quizzes = await sql`
      SELECT 
        k.id_kuis as id,
        k.judul_kuis as title,
        k.deskripsi as description,
        k.gambar as image,
        k.kategori as category,
        k.kesulitan_kuis as difficulty,
        k.tanggal_dibuat as created_at,
        p.nama_pengguna as author_name,
        p.foto_pengguna as author_avatar,
        COUNT(DISTINCT hk.id_hasil_kuis) as attempts_count
      FROM data_kuis k
      LEFT JOIN pengguna p ON k.id_pengguna = p.id_pengguna
      LEFT JOIN data_hasil_kuis hk ON k.id_kuis = hk.id_kuis
      GROUP BY k.id_kuis, p.nama_pengguna, p.foto_pengguna
      ORDER BY k.tanggal_dibuat DESC
    `;

    res.json({ quizzes });
  } catch (error) {
    console.error('Error fetching quizzes:', error);
    res.status(500).json({ message: 'Gagal mengambil data kuis' });
  }
};

export const getAllEvents = async (req, res) => {
  try {
    const events = await sql`
      SELECT
        e.id_event as id,
        e.judul_event as title,
        e.deskripsi as description,
        e.status_acara as status,
        e.gambar as image,
        e.jenis_acara as type,
        e.tanggal_acara as date,
        e.waktu_acara as time,
        e.total_partisipan as total_participants,
        e.partisipan as participants,
        e.biaya_acara as fee,
        p.nama_penyelenggara as organizer_name
      FROM data_event e
      LEFT JOIN data_penyelenggara p ON e.id_penyelenggara = p.id_penyelenggara
      ORDER BY e.tanggal_acara DESC NULLS LAST
    `;

    res.json({ events });
  } catch (error) {
    console.error("Error fetching events:", error);
    res.status(500).json({ message: "Gagal mengambil data event" });
  }
};

export const deleteUser = async (req, res) => {
  try {
    const { id } = req.params;

    await sql`
      DELETE FROM pengguna
      WHERE id_pengguna = ${id}
    `;

    res.json({ message: 'User berhasil dihapus' });
  } catch (error) {
    console.error('Error deleting user:', error);
    res.status(500).json({ message: 'Gagal menghapus user' });
  }
};

export const deleteArticle = async (req, res) => {
  try {
    const { id } = req.params;

    await sql`
      DELETE FROM data_riwayat_bacaan
      WHERE id_artikel = ${id}
    `;

    await sql`
      DELETE FROM artikel_likes
      WHERE id_artikel = ${id}
    `;

    await sql`
      DELETE FROM data_artikel
      WHERE id_artikel = ${id}
    `;

    res.json({ message: 'Artikel berhasil dihapus' });
  } catch (error) {
    console.error('Error deleting article:', error);
    res.status(500).json({ message: 'Gagal menghapus artikel' });
  }
};

export const deleteQuiz = async (req, res) => {
  try {
    const { id } = req.params;

    await sql`
      DELETE FROM data_hasil_kuis
      WHERE id_kuis = ${id}
    `;

    await sql`
      DELETE FROM data_riwayat_kuis
      WHERE id_kuis = ${id}
    `;

    await sql`
      DELETE FROM data_kuis
      WHERE id_kuis = ${id}
    `;

    res.json({ message: 'Kuis berhasil dihapus' });
  } catch (error) {
    console.error('Error deleting quiz:', error);
    res.status(500).json({ message: 'Gagal menghapus kuis' });
  }
};

export const deleteEvent = async (req, res) => {
  try {
    const { id } = req.params;

    await sql`
      DELETE FROM data_partisipasi_event
      WHERE id_event = ${id}
    `;

    await sql`
      DELETE FROM data_riwayat_event
      WHERE id_event = ${id}
    `;

    await sql`
      DELETE FROM data_event
      WHERE id_event = ${id}
    `;

    res.json({ message: "Event berhasil dihapus" });
  } catch (error) {
    console.error("Error deleting event:", error);
    res.status(500).json({ message: "Gagal menghapus event" });
  }
};
