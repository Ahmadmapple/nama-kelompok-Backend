import sql from "../config/db.js";
import cloudinary from "../config/cloudinary.js";

const createKuis = async (req, res) => {
  const { metadata, questions } = req.body;

  // Pastikan req.user.id tersedia dari middleware
  const id_pengguna = req.user.id;

  if (!metadata || !questions) {
    return res
      .status(400)
      .json({ message: "Metadata atau questions tidak boleh kosong." });
  }

  let quizMeta;
  let quizQuestions;
  try {
    quizMeta = JSON.parse(metadata);
    quizQuestions = JSON.parse(questions);
  } catch (parseError) {
    return res.status(400).json({
      message: "Format JSON untuk metadata atau questions tidak valid.",
      error: parseError.message,
    });
  }

  if (!Array.isArray(quizQuestions) || quizQuestions.length === 0) {
    return res.status(400).json({
      message: "Daftar pertanyaan (questions) tidak valid atau kosong.",
    });
  }

  const parsedTags = quizMeta.tags || [];

  const totalDurationSeconds = quizQuestions.reduce(
    (acc, q) => acc + (Number(q.timeLimit) || 30),
    0
  );
  const totalTimeMinutes = Math.ceil(totalDurationSeconds / 60);

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
      return res
        .status(500)
        .json({ message: "Gagal mengunggah gambar cover kuis." });
    }
  }

  try {
    await sql`BEGIN`;

    const quizResult = await sql`
      INSERT INTO data_kuis (
        judul_kuis,
        deskripsi,
        kesulitan_kuis,
        kategori,
        gambar,
        jumlah_soal,
        waktu_pengerjaan_menit,
        status,
        id_pengguna, /* <-- DITAMBAHKAN */
        tanggal_dibuat
      )
      VALUES (
        ${quizMeta.title},
        ${quizMeta.description},
        ${quizMeta.difficulty || "easy"},
        ${quizMeta.category},
        ${imageUrl},
        ${quizQuestions.length},
        ${totalTimeMinutes},
        'aktif',
        ${id_pengguna}, /* <-- DITAMBAHKAN */
        NOW() 
      )
      RETURNING id_kuis;
    `;

    const id_kuis = quizResult[0].id_kuis;

    for (const q of quizQuestions) {
      const conceptsString = Array.isArray(q.relatedConcepts)
        ? q.relatedConcepts.filter((c) => c.length > 0).join(",")
        : q.relatedConcepts || "";
      const optionsArray = Array.isArray(q.options)
        ? q.options.filter((o) => o.trim().length > 0)
        : [];
      const correctAnswerString = String(q.correctAnswer);

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
          tips_soal            
        )
        VALUES (
          ${id_kuis},
          ${q.question},
          ${optionsArray},         
          ${correctAnswerString},
          ${q.timeLimit || 30},
          ${q.difficulty || "medium"},
          ${quizMeta.category},
          ${q.score}, 
          ${conceptsString},
          ${q.explanation || ""},
          ${q.learningTips || ""} 
        );
      `;
    }

    // --- LOGIKA PENYIMPANAN TAGS (Sudah benar) ---
    if (parsedTags.length > 0) {
      for (const tagName of parsedTags) {
        if (!tagName || !tagName.trim()) continue;

        let tagRows =
          await sql`SELECT id_tag FROM data_tag WHERE nama_tag = ${tagName}`;
        let id_tag;
        if (tagRows.length > 0) {
          id_tag = tagRows[0].id_tag;
        } else {
          const insertTag =
            await sql`INSERT INTO data_tag (nama_tag) VALUES (${tagName}) RETURNING id_tag`;
          id_tag = insertTag[0].id_tag;
        }

        // Menyimpan relasi kuis dan tag
        await sql`INSERT INTO data_tag_kuis (id_kuis, id_tag) VALUES (${id_kuis}, ${id_tag})`;
      }
    }
    // ---------------------------------------------

    await sql`COMMIT`;

    res.status(201).json({
      message: "Kuis berhasil dibuat!",
      id_kuis,
      jumlah_soal: quizQuestions.length,
      tags_processed: parsedTags.length,
      imageUrl,
    });
  } catch (error) {
    await sql`ROLLBACK`;
    console.error("Error create kuis:", error);
    res.status(500).json({
      message: "Gagal membuat kuis. Transaksi dibatalkan.",
      error: error.message,
    });
  }
};

const getKuis = async (req, res) => {
  try {
    // 1️⃣ Ambil semua kuis
    const kuisList = await sql`
      SELECT 
        k.id_kuis AS id,
        k.judul_kuis AS title,
        k.deskripsi AS description,
        k.kategori AS category,
        k.gambar AS image,
        k.kesulitan_kuis AS difficulty,
        k.waktu_pengerjaan_menit AS totalTime,
        k.id_pengguna AS creatorId,
        p.nama_pengguna AS creatorName,
        p.foto_pengguna AS creatorImage
      FROM data_kuis k
      JOIN pengguna p ON p.id_pengguna = k.id_pengguna
      ORDER BY k.id_kuis ASC
    `;

    if (!kuisList || kuisList.length === 0) {
      return res.status(200).json([]);
    }

    // 2️⃣ Ambil detail untuk setiap kuis
    const kuisWithDetails = await Promise.all(
      kuisList.map(async (quiz) => {
        // A. Ambil pertanyaan
        const questions = await sql`
          SELECT 
            q.id_soal AS id,
            q.teks_soal AS question,
            q.pilihan_jawaban AS options,
            q.kunci_jawaban AS correctanswer,
            q.penjelasan AS explanation,
            q.tips_soal AS learningtips,
            q.konsep AS relatedconcepts,
            q.kesulitan_soal AS difficulty,
            q.waktu_per_soal_detik AS timelimit,
            q.skor_soal AS score
          FROM data_soal_kuis q
          WHERE q.id_kuis = ${quiz.id}
          ORDER BY q.id_soal ASC
        `;

        // B. Ambil tags
        const tagResults = await sql`
          SELECT t.nama_tag
          FROM data_tag_kuis tk
          JOIN data_tag t ON t.id_tag = tk.id_tag
          WHERE tk.id_kuis = ${quiz.id}
        `;

        const tags = tagResults.map((t) => t.nama_tag);

        // 🔥 C. FORMAT PERTANYAAN - FIX UTAMA UNTUK VARCHAR kunci_jawaban
        const formattedQuestions = questions.map((q) => {
          const rawCorrectAnswer = q.correctanswer; // VARCHAR: "0", "3"
          const rawTimeLimit = q.timelimit;
          const conceptString = q.relatedconcepts;

          // ✅ FIX DEFINITIF: Handle VARCHAR kunci_jawaban
          let safeCorrectAnswer = -1;
          if (rawCorrectAnswer !== null && rawCorrectAnswer !== undefined && rawCorrectAnswer !== '') {
            const trimmed = String(rawCorrectAnswer).trim();
            const num = Number(trimmed);
            // Validasi: harus angka 0-3
            if (!isNaN(num) && num >= 0 && num <= 3) {
              safeCorrectAnswer = num;
            } else {
              console.warn(`❌ Invalid kunci_jawaban="${rawCorrectAnswer}" untuk soal ${q.id.slice(-8)}`);
            }
          }

          const safeTimeLimit = Number(rawTimeLimit) || 30;
          const safeScore = Number(q.score) || 0;

          // DEBUG LOG (bisa dihapus nanti)
          console.log(`✅ Q${q.id.slice(-8)}: "${rawCorrectAnswer}" → ${safeCorrectAnswer}`);

          return {
            id: q.id,
            question: q.question || '',
            options: q.options || [],
            correctAnswer: safeCorrectAnswer, // SEMPURNA: 0,1,2,3 atau -1
            explanation: q.explanation || '',
            learningTips: q.learningtips || '',
            relatedConcepts: conceptString
              ? String(conceptString)
                  .split(',')
                  .map((c) => c.trim())
                  .filter((c) => c.length > 0)
              : [],
            difficulty: q.difficulty || 'easy',
            timeLimit: safeTimeLimit,
            score: safeScore,
          };
        });

        return {
          ...quiz,
          tags,
          questions: formattedQuestions,
        };
      })
    );

    res.status(200).json(kuisWithDetails);
  } catch (error) {
    console.error("❌ Error fetching quizzes:", error);
    res.status(500).json({
      message: "Gagal mengambil data kuis",
      error: error.message,
      details: error.position ? `Position: ${error.position}` : 'Unknown'
    });
  }
};

export { createKuis, getKuis };
