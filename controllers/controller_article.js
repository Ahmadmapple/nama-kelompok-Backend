// controllers/controller_get_articles.js
import sql from "../config/db.js";

// Get all articles
const getArticles = async (req, res) => {
  try {
    const articles = await sql`
      SELECT
        a.id_artikel,
        a.nama_artikel,
        a.deskripsi,
        a.kategori,
        a.kesulitan,
        a.perkiraan_waktu_menit,
        a.view_artikel,
        a.like_artikel,
        a.tanggal_publish,
        a.gambar_artikel,

        json_build_object(
          'id', p.id_pengguna,
          'nama', p.nama_pengguna,
          'avatar', p.foto_pengguna
        ) AS author,

        COALESCE(
          json_agg(DISTINCT t.nama_tag)
          FILTER (WHERE t.nama_tag IS NOT NULL),
          '[]'
        ) AS tags

      FROM data_artikel a
      JOIN pengguna p ON p.id_pengguna = a.id_pengguna
      LEFT JOIN data_tag_artikel dta ON dta.id_artikel = a.id_artikel
      LEFT JOIN data_tag t ON t.id_tag = dta.id_tag
      GROUP BY a.id_artikel, p.id_pengguna
      ORDER BY a.tanggal_publish DESC;
    `;

    res.json(articles);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Gagal mengambil artikel" });
  }
};

// Get article by ID + check if user liked
const getArticleById = async (req, res) => {
  const { id } = req.params;
  const userId = req.user?.id || null; // use null if not logged in

  try {
    const result = await sql`
      SELECT
        a.id_artikel,
        a.nama_artikel,
        a.deskripsi,
        a.isi_artikel,
        a.kategori,
        a.kesulitan,
        a.perkiraan_waktu_menit,
        a.view_artikel,
        a.like_artikel,
        a.tanggal_publish,
        a.gambar_artikel,

        json_build_object(
          'id', p.id_pengguna,
          'nama', p.nama_pengguna,
          'avatar', p.foto_pengguna
        ) AS author,

        COALESCE(
          json_agg(DISTINCT t.nama_tag)
          FILTER (WHERE t.nama_tag IS NOT NULL),
          '[]'
        ) AS tags,

        CASE 
          WHEN ${userId}::uuid IS NOT NULL AND EXISTS (
            SELECT 1 FROM artikel_likes al
            WHERE al.id_artikel = a.id_artikel AND al.id_pengguna = ${userId}::uuid
          ) THEN true
          ELSE false
        END AS is_liked

      FROM data_artikel a
      JOIN pengguna p ON p.id_pengguna = a.id_pengguna
      LEFT JOIN data_tag_artikel dta ON dta.id_artikel = a.id_artikel
      LEFT JOIN data_tag t ON t.id_tag = dta.id_tag
      WHERE a.id_artikel = ${id}
      GROUP BY a.id_artikel, p.id_pengguna;
    `;

    if (result.length === 0) {
      return res.status(404).json({ message: "Artikel tidak ditemukan" });
    }

    res.json(result[0]);
  } catch (error) {
    console.error("getArticleById error:", error);
    res.status(500).json({ message: "Gagal mengambil artikel" });
  }
};

// Toggle like/unlike
// Requires auth middleware
const addLike = async (req, res) => {
  const { id } = req.params;
  const userId = req.user.id; // from auth middleware

  try {
    // Check if user already liked the article
    const liked = await sql`
      SELECT 1 FROM artikel_likes
      WHERE id_artikel = ${id} AND id_pengguna = ${userId};
    `;

    let isLikedNow;
    if (liked.length > 0) {
      // Unlike
      await sql`
        DELETE FROM artikel_likes
        WHERE id_artikel = ${id} AND id_pengguna = ${userId};
      `;
      await sql`
        UPDATE data_artikel
        SET like_artikel = like_artikel - 1
        WHERE id_artikel = ${id};
      `;
      isLikedNow = false;
    } else {
      // Like
      await sql`
        INSERT INTO artikel_likes (id_artikel, id_pengguna)
        VALUES (${id}, ${userId});
      `;
      await sql`
        UPDATE data_artikel
        SET like_artikel = like_artikel + 1
        WHERE id_artikel = ${id};
      `;
      isLikedNow = true;
    }

    // Return updated like count and current user's like status
    const updated = await sql`
      SELECT like_artikel FROM data_artikel
      WHERE id_artikel = ${id};
    `;

    res.json({
      like_artikel: updated[0].like_artikel,
      is_liked: isLikedNow
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Gagal toggle like" });
  }
};

// Increment view separately if needed
const addView = async (req, res) => {
  const { id } = req.params;

  try {
    const result = await sql`
      UPDATE data_artikel
      SET view_artikel = view_artikel + 1
      WHERE id_artikel = ${id}
      RETURNING view_artikel;
    `;

    if (result.length === 0) {
      return res.status(404).json({ message: "Artikel tidak ditemukan" });
    }

    res.json({ view_artikel: result[0].view_artikel });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Gagal menambahkan view" });
  }
};

const addRiwayatBaca = async (req, res) => {
  const { id: idArtikel } = req.params;
  const idUser = req.user.id; // pastikan authenticate middleware

  if (!idArtikel) {
    return res.status(400).json({ message: "ID artikel diperlukan" });
  }

  try {
    // 1️⃣ Ambil id_progres user
    const progresResult = await sql`
      SELECT id_progres FROM data_progres_pengguna WHERE id_pengguna = ${idUser}
    `;

    if (!progresResult.length) {
      return res.status(404).json({ message: "Progres pengguna tidak ditemukan" });
    }

    const idProgres = progresResult[0].id_progres;

    // 2️⃣ Insert atau update jika sudah ada
    await sql`
      INSERT INTO data_riwayat_bacaan (id_progres, id_artikel, tanggal_baca)
      VALUES (${idProgres}, ${idArtikel}, NOW())
      ON CONFLICT (id_progres, id_artikel)
      DO UPDATE SET tanggal_baca = NOW()
    `;

    res.json({ message: "Riwayat baca berhasil dicatat" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Gagal mencatat riwayat baca" });
  }
};

const updateProgresPengguna = async (req, res) => {
  const idUser = req.user.id; 
  const { durasi } = req.body;

  const durasiMenit = parseInt(durasi) || 0;

  try {
    // 1. Update Progres Umum (Waktu & Jumlah Artikel)
    await sql`
      INSERT INTO data_progres_pengguna (id_pengguna, waktu_membaca, artikel_dibaca, skor_literasi_pengguna)
      VALUES (${idUser}, ${durasiMenit}, 1, 0)
      ON CONFLICT (id_pengguna)
      DO UPDATE SET
        waktu_membaca = data_progres_pengguna.waktu_membaca + EXCLUDED.waktu_membaca,
        artikel_dibaca = data_progres_pengguna.artikel_dibaca + 1
    `;

    // 2. Update Detail Skill DAN Hitung Rata-rata Skor Utama
    // Sesuai permintaan: Skor Utama = (Semua Skor Kemampuan) / 5
    await sql`
      WITH updated_detail AS (
        UPDATE data_detail_kemampuan_literasi
        SET 
          pemahaman_bacaan = LEAST(pemahaman_bacaan + 2, 100),
          kecepatan_membaca = LEAST(kecepatan_membaca + 1.5, 100)
        WHERE id_progres = (
          SELECT id_progres FROM data_progres_pengguna WHERE id_pengguna = ${idUser}
        )
        RETURNING *
      )
      UPDATE data_progres_pengguna
      SET skor_literasi_pengguna = (
        SELECT (pemahaman_bacaan + kecepatan_membaca + analisis_kritis + fact_checking + menulis_ringkasan) / 5
        FROM updated_detail
      )
      WHERE id_pengguna = ${idUser};
    `;

    res.json({ 
      success: true, 
      message: "Progres diperbarui dan skor literasi dihitung ulang!" 
    });

  } catch (err) {
    console.error("--- ERROR NEON DATABASE ---");
    console.error(err.message);
    res.status(500).json({ message: "Gagal update", error: err.message });
  }
};

export { getArticles, getArticleById, addView, addLike, addRiwayatBaca, updateProgresPengguna };