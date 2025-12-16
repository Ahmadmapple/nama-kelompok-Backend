import sql from "../config/db.js";
import cloudinary from "../config/cloudinary.js";

const createKuis = async (req, res) => {
  const {
    metadata, // JSON string from FormData
    questions, // JSON string array of questions
  } = req.body;

  const id_pengguna = req.user.id; // from authenticate middleware
  // NOTE: id_pengguna tidak digunakan di INSERT data_kuis karena kolom tsb tidak ada di skema Anda.

  if (!metadata || !questions) {
    return res.status(400).json({ message: "Metadata atau questions tidak boleh kosong" });
  }

  // Parse JSON strings
  const quizMeta = JSON.parse(metadata);
  const quizQuestions = JSON.parse(questions);
  const parsedTags = quizMeta.tags || []; // array of tag names
  const totalTimeMinutes = Math.ceil(quizQuestions.reduce((acc, q) => acc + (Number(q.timeLimit) || 30), 0) / 60);
  // ===============================
  // Upload gambar ke Cloudinary
  // ===============================
  let imageUrl = null;
  if (req.file) {
    try {
      imageUrl = await new Promise((resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream(
          { folder: "kuis", resource_type: "image" },
          (err, result) => {
            if (err) return reject(err);
            resolve(result.secure_url);
          }
        );
        stream.end(req.file.buffer);
      });
    } catch (uploadError) {
      console.error("Gagal mengunggah gambar ke Cloudinary:", uploadError);
      return res.status(500).json({ message: "Gagal mengunggah gambar cover." });
    }
  }

  try {
    // =======================================================
    // Mulai transaksi
    // =======================================================
    await sql`BEGIN`;
    
    // =======================================================
    // 1. Insert metadata kuis (Tabel: data_kuis)
    // PERBAIKAN: Menghapus kolom 'tips' yang tidak ada di DB.
    // =======================================================
    const quizResult = await sql`
      INSERT INTO data_kuis (
        judul_kuis,
        deskripsi,
        kesulitan_kuis,
        kategori,
        gambar,
        jumlah_soal,
        waktu_pengerjaan_menit,
        status
      )
      VALUES (
        ${quizMeta.title},
        ${quizMeta.description},
        ${quizMeta.difficulty || 'easy'},
        ${quizMeta.category},
        ${imageUrl},
        ${quizQuestions.length},
        ${totalTimeMinutes}, -- Hitung total waktu dlm menit
        'aktif'
      )
      RETURNING id_kuis;
    `;

    const id_kuis = quizResult[0].id_kuis;

    // =======================================================
    // 2. Insert questions (Tabel: data_soal_kuis)
    // PERBAIKAN: Menambahkan kolom 'tips_soal' dan nilainya dari q.learningTips.
    // =======================================================
    for (const q of quizQuestions) {
      // Pastikan q.relatedConcepts dipisahkan koma karena kolom 'konsep' adalah VARCHAR(50)
      const conceptsString = Array.isArray(q.relatedConcepts) 
        ? q.relatedConcepts.filter(c => c.length > 0).join(',')
        : q.relatedConcepts;

      await sql`
        INSERT INTO data_soal_kuis (
          id_kuis,
          teks_soal,
          pilihan_jawaban,
          kunci_jawaban,
          waktu_per_soal_detik,
          kesulitan_soal,
          kategori_soal,
          skor_soal,
          konsep,
          penjelasan,
          tips_soal               -- KOLOM TAMBAHAN UNTUK TIPS BELAJAR
        )
        VALUES (
          ${id_kuis},
          ${q.question},
          ${q.options},           -- Tipe data array TEXT[] di DB Anda
          ${q.correctAnswer}, 
          ${q.timeLimit || 30},
          ${q.difficulty},
          ${quizMeta.category},
          10,
          ${conceptsString},
          ${q.explanation},
          ${q.learningTips || ''} -- MAP DARI FRONTEND learningTips
        );
      `;
    }

    // =======================================================
    // 3. Insert / link tags (Tabel: data_tag, data_tag_kuis)
    // =======================================================
    if (parsedTags.length > 0) {
      for (const tagName of parsedTags) {
        let tagRows = await sql`SELECT id_tag FROM data_tag WHERE nama_tag = ${tagName}`;
        let id_tag;
        if (tagRows.length > 0) {
          id_tag = tagRows[0].id_tag;
        } else {
          const insertTag = await sql`INSERT INTO data_tag (nama_tag) VALUES (${tagName}) RETURNING id_tag`;
          id_tag = insertTag[0].id_tag;
        }

        await sql`INSERT INTO data_tag_kuis (id_kuis, id_tag) VALUES (${id_kuis}, ${id_tag})`;
      }
    }

    // =======================================================
    // Commit transaksi
    // =======================================================
    await sql`COMMIT`;

    res.status(201).json({
      message: "Kuis berhasil dibuat!",
      id_kuis,
      tags_processed: parsedTags.length,
      imageUrl,
    });
  } catch (error) {
    await sql`ROLLBACK`;
    console.error("Error create kuis:", error);
    res.status(500).json({ message: "Gagal membuat kuis", error: error.message });
  }
};

 const getKuis = async (req, res) => {
  try {
    // 1️⃣ Ambil semua kuis
    // NOTE: Kolom 'tips' tidak ada di data_kuis, maka dihapus.
    const kuisList = await sql`
      SELECT
        k.id_kuis AS id,
        k.judul_kuis AS title,
        k.deskripsi AS description,
        k.kategori AS category,
        k.gambar AS image,
        k.kesulitan_kuis AS difficulty,
        k.waktu_pengerjaan_menit AS totalTime -- Ganti alias untuk konsistensi
      FROM data_kuis k
      ORDER BY k.id_kuis ASC;
    `;

    if (!kuisList || kuisList.length === 0) {
      return res.status(200).json([]);
    }

    // 2️⃣ Ambil pertanyaan dan tags untuk setiap kuis (menggunakan Promise.all)
    const kuisWithDetails = await Promise.all(
      kuisList.map(async (quiz) => {
        // A. Ambil Pertanyaan (Tabel: data_soal_kuis)
        const questions = await sql`
          SELECT
            q.id_soal AS id,                  -- PERBAIKAN: Mengganti id_soal_kuis menjadi id_soal
            q.teks_soal AS question,
            q.pilihan_jawaban AS options,
            q.kunci_jawaban AS correctAnswer,
            q.penjelasan AS explanation,
            q.tips_soal AS learningTips,
            q.konsep AS relatedConcepts,
            q.kesulitan_soal AS difficulty,
            q.waktu_per_soal_detik AS timeLimit
          FROM data_soal_kuis q
          WHERE q.id_kuis = ${quiz.id}
          ORDER BY q.id_soal ASC;             -- PERBAIKAN: Mengganti id_soal_kuis menjadi id_soal
        `;

        // B. Ambil Tags (Melalui join dengan data_tag_kuis)
        const tagResults = await sql`
            SELECT 
                t.nama_tag
            FROM data_tag_kuis tk
            JOIN data_tag t ON t.id_tag = tk.id_tag
            WHERE tk.id_kuis = ${quiz.id};
        `;
        
        const tags = tagResults.map(t => t.nama_tag);

        // C. Format Pertanyaan
        const formattedQuestions = questions.map((q) => ({
          id: q.id,
          question: q.question,
          options: q.options, // Sudah berupa array karena tipe DB adalah TEXT[]
          correctAnswer: q.correctAnswer,
          explanation: q.explanation,
          learningTips: q.learningTips,
          // Kolom konsep (VARCHAR) harus di-split koma menjadi array
          relatedConcepts: q.relatedConcepts 
            ? q.relatedConcepts.split(",").map((c) => c.trim()).filter(c => c.length > 0)
            : [],
          difficulty: q.difficulty,
          timeLimit: q.timeLimit,
        }));

        return {
          ...quiz,
          // Tambahkan tags yang sudah diambil
          tags: tags, 
          questions: formattedQuestions,
        };
      })
    );

    res.status(200).json(kuisWithDetails);
  } catch (error) {
    console.error("Error fetching quizzes:", error);
    res.status(500).json({ message: "Gagal mengambil data kuis" });
  }
};

const getKuisById = async (req, res) => {}
export { createKuis, getKuis, getKuisById };