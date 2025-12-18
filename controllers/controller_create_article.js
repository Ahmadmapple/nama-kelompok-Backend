import sql from "../config/db.js";
import cloudinary from "../config/cloudinary.js";

const createArticle = async (req, res) => {
  const {
    nama_artikel,
    deskripsi,
    kategori,
    kesulitan,
    perkiraan_waktu_menit,
    isi_artikel,
    tags, // ⬅️ masih string JSON dari FormData
  } = req.body;

  const id_pengguna = req.user.id;
  // ===============================
  // FIX 1: parse tags
  // ===============================
  const parsedTags = tags ? JSON.parse(tags) : [];

  // ===============================
  // FIX 2: upload image
  // ===============================
  let gambarArtikelUrl = null;

  if (req.file) {
    const uploadResult = await cloudinary.uploader.upload(
      `data:${req.file.mimetype};base64,${req.file.buffer.toString("base64")}`,
      { folder: "artikel" }
    );
    gambarArtikelUrl = uploadResult.secure_url;
  }

  const readTimeInt = parseInt(perkiraan_waktu_menit, 10);

  try {
    // =======================================================
    // 0. Mulai Transaksi
    // =======================================================
    await sql`BEGIN`;

    // =======================================================
    // A. Insert Artikel
    // =======================================================
    const articleResult = await sql`
      INSERT INTO public.data_artikel (
        id_pengguna,
        nama_artikel,
        deskripsi,
        isi_artikel,
        gambar_artikel,
        kategori,
        kesulitan,
        perkiraan_waktu_menit
      )
      VALUES (
        ${id_pengguna},
        ${nama_artikel},
        ${deskripsi},
        ${isi_artikel},
        ${gambarArtikelUrl},
        ${kategori},
        ${kesulitan},
        ${readTimeInt}
      )
      RETURNING id_artikel;
    `;

    const id_artikel = articleResult[0].id_artikel;
    const tagArticleLinks = [];

    // =======================================================
    // B. Handle Tags
    // =======================================================
    // =======================================================
    // B. Handle Tags (AMAN)
    // =======================================================
    if (parsedTags.length > 0) {
      for (const tagName of parsedTags) {
        if (!tagName || !tagName.trim()) continue;

        const tagResult = await sql`
      INSERT INTO public.data_tag (nama_tag)
      VALUES (${tagName})
      ON CONFLICT (nama_tag)
      DO UPDATE SET nama_tag = EXCLUDED.nama_tag
      RETURNING id_tag;
    `;

        const id_tag = tagResult[0].id_tag;

        await sql`
      INSERT INTO public.data_tag_artikel (id_tag, id_artikel)
      VALUES (${id_tag}, ${id_artikel})
      ON CONFLICT DO NOTHING;
    `;
      }
    }

    // =======================================================
    // C. Update Menulis Ringkasan Skill
    // =======================================================
    // Ambil id_progres user
    const progressResult = await sql`
      SELECT id_progres FROM data_progres_pengguna WHERE id_pengguna = ${id_pengguna}
    `;

    if (progressResult.length > 0) {
      const idProgres = progressResult[0].id_progres;
      
      // Hitung peningkatan berdasarkan panjang artikel dan kesulitan
      // Range 1-3 poin
      const wordCount = isi_artikel.split(/\s+/).length;
      
      // Formula: 1 + (min(wordCount, 500) / 500 * 2)
      // 100 kata = 1.4 poin, 300 kata = 2.2 poin, 500+ kata = 3 poin
      const baseIncrease = 1 + (Math.min(wordCount, 500) / 500) * 2;
      
      // Multiplier berdasarkan kesulitan
      const difficultyMultiplier = {
        'mudah': 1,
        'menengah': 1.2,
        'sulit': 1.5
      };
      
      const skillIncrease = Math.min(3, baseIncrease * (difficultyMultiplier[kesulitan.toLowerCase()] || 1));
      
      // Update menulis_ringkasan
      await sql`
        UPDATE data_detail_kemampuan_literasi
        SET menulis_ringkasan = LEAST(100, menulis_ringkasan + ${skillIncrease})
        WHERE id_progres = ${idProgres}
      `;
      
      // Update skor literasi (rata-rata dari 5 kemampuan)
      await sql`
        UPDATE data_progres_pengguna dpp
        SET skor_literasi_pengguna = (
          SELECT (
            dkl.pemahaman_bacaan + 
            dkl.kecepatan_membaca + 
            dkl.analisis_kritis + 
            dkl.fact_checking + 
            dkl.menulis_ringkasan
          ) / 5
          FROM data_detail_kemampuan_literasi dkl
          WHERE dkl.id_progres = dpp.id_progres
        )
        WHERE dpp.id_pengguna = ${id_pengguna}
      `;
      
      console.log('Menulis ringkasan skill updated:', { wordCount, skillIncrease: skillIncrease.toFixed(2) });
    }

    // =======================================================
    // COMMIT
    // =======================================================
    await sql`COMMIT`;

    res.status(201).json({
      message: "Artikel berhasil dipublikasikan!",
      id_artikel,
      tags_processed: parsedTags.length,
    });
  } catch (error) {
    await sql`ROLLBACK`;

    console.error("Kesalahan saat memublikasikan artikel:", error);
    res.status(500).json({
      message: "Gagal memublikasikan artikel.",
      error: error.message,
    });
  }
};

export { createArticle };
