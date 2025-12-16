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

  const id_pengguna = req.user.id
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
    if (parsedTags.length > 0) {
      for (const tagName of parsedTags) {
        let tagRows = await sql`
          SELECT id_tag FROM public.data_tag WHERE nama_tag = ${tagName};
        `;

        let id_tag;

        if (tagRows.length > 0) {
          id_tag = tagRows[0].id_tag;
        } else {
          const insertResult = await sql`
            INSERT INTO public.data_tag (nama_tag)
            VALUES (${tagName})
            RETURNING id_tag;
          `;
          id_tag = insertResult[0].id_tag;
        }

        tagArticleLinks.push({ id_tag, id_artikel });
      }
    }

    // =======================================================
    // C. Link Artikel - Tag
    // =======================================================
    if (tagArticleLinks.length > 0) {
      await Promise.all(
        tagArticleLinks.map((link) =>
          sql`
            INSERT INTO public.data_tag_artikel (id_tag, id_artikel)
            VALUES (${link.id_tag}, ${link.id_artikel});
          `
        )
      );
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