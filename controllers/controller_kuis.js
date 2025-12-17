import sql from "../config/db.js";
import cloudinary from "../config/cloudinary.js";

// --- CONTROLLER 1: CREATE KUIS (Eksisting) ---
const createKuis = async (req, res) => {
  const { metadata, questions } = req.body;
  const id_pengguna = req.user.id;

  if (!metadata || !questions) {
    return res.status(400).json({ message: "Metadata atau questions tidak boleh kosong." });
  }

  let quizMeta, quizQuestions;
  try {
    quizMeta = JSON.parse(metadata);
    quizQuestions = JSON.parse(questions);
  } catch (parseError) {
    return res.status(400).json({ message: "Format JSON tidak valid." });
  }

  const totalDurationSeconds = quizQuestions.reduce((acc, q) => acc + (Number(q.timeLimit) || 30), 0);
  const totalTimeMinutes = Math.ceil(totalDurationSeconds / 60);

  let imageUrl = null;
  if (req.file) {
    try {
      imageUrl = await new Promise((resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream(
          { folder: "kuis", resource_type: "image" },
          (err, result) => (err ? reject(err) : resolve(result.secure_url))
        );
        stream.end(req.file.buffer);
      });
    } catch (e) { return res.status(500).json({ message: "Gagal upload gambar." }); }
  }

  try {
    await sql`BEGIN`;
    const quizResult = await sql`
      INSERT INTO data_kuis (judul_kuis, deskripsi, kesulitan_kuis, kategori, gambar, jumlah_soal, waktu_pengerjaan_menit, status, id_pengguna, tanggal_dibuat)
      VALUES (${quizMeta.title}, ${quizMeta.description}, ${quizMeta.difficulty || "easy"}, ${quizMeta.category}, ${imageUrl}, ${quizQuestions.length}, ${totalTimeMinutes}, 'aktif', ${id_pengguna}, NOW())
      RETURNING id_kuis;
    `;

    const id_kuis = quizResult[0].id_kuis;

    for (const q of quizQuestions) {
      await sql`
        INSERT INTO data_soal_kuis (id_kuis, teks_soal, pilihan_jawaban, kunci_jawaban, waktu_per_soal_detik, kesulitan_soal, kategori_soal, skor_soal, konsep, penjelasan, tips_soal)
        VALUES (${id_kuis}, ${q.question}, ${q.options || []}, ${String(q.correctAnswer)}, ${q.timeLimit || 30}, ${q.difficulty || "medium"}, ${quizMeta.category}, ${q.score}, ${q.relatedConcepts?.join(",")}, ${q.explanation || ""}, ${q.learningTips || ""});
      `;
    }

    await sql`COMMIT`;
    res.status(201).json({ message: "Kuis berhasil dibuat!", id_kuis });
  } catch (error) {
    await sql`ROLLBACK`;
    res.status(500).json({ message: "Gagal membuat kuis.", error: error.message });
  }
};

// --- CONTROLLER 2: GET KUIS (Eksisting) ---
const getKuis = async (req, res) => {
  try {
    const { category, simple } = req.query;

    if (simple === "true") {
      const simpleQuiz = await sql`
        SELECT k.id_kuis, k.judul_kuis, k.kategori, k.gambar, k.waktu_pengerjaan_menit, COUNT(q.id_soal)::int AS jumlah_soal
        FROM data_kuis k LEFT JOIN data_soal_kuis q ON q.id_kuis = k.id_kuis
        WHERE ${category ? sql`k.kategori = ${category}` : sql`TRUE`} AND k.status = 'aktif'
        GROUP BY k.id_kuis ORDER BY k.tanggal_dibuat DESC;
      `;
      return res.status(200).json(simpleQuiz);
    }

    const kuisList = await sql`
      SELECT k.id_kuis AS id, k.judul_kuis AS title, k.deskripsi AS description, k.kategori AS category, k.gambar AS image, k.kesulitan_kuis AS difficulty, k.waktu_pengerjaan_menit AS totaltime, k.id_pengguna AS creatorid, p.nama_pengguna AS creatorname, p.foto_pengguna AS creatorimage
      FROM data_kuis k JOIN pengguna p ON p.id_pengguna = k.id_pengguna ORDER BY k.tanggal_dibuat DESC;
    `;

    const kuisWithDetails = await Promise.all(kuisList.map(async (quiz) => {
      const questions = await sql`SELECT id_soal AS id, teks_soal AS question, pilihan_jawaban AS options, kunci_jawaban AS correctanswer, penjelasan, tips_soal, konsep, kesulitan_soal, waktu_per_soal_detik AS timelimit, skor_soal AS score FROM data_soal_kuis WHERE id_kuis = ${quiz.id}`;
      return { ...quiz, questions: questions.map(q => ({ ...q, correctAnswer: Number(q.correctanswer) })) };
    }));

    res.status(200).json(kuisWithDetails);
  } catch (error) {
    res.status(500).json({ message: "Gagal ambil kuis", error: error.message });
  }
};

// --- CONTROLLER 3: SUBMIT KUIS RESULT (NEW) ---
/**
 * Menyimpan hasil kuis ke tabel hasil_kuis dan data_riwayat_kuis
 */
const submitKuisResult = async (req, res) => {
  const { quizId, score, correctAnswers, totalQuestions } = req.body;
  const userId = req.user.id;

  try {
    await sql`BEGIN`;

    // 1. Simpan ke tabel hasil_kuis (Detail skor pengerjaan)
    await sql`
      INSERT INTO hasil_kuis (id_pengguna, id_kuis, skor, jawaban_benar, total_soal, tanggal_pengerjaan)
      VALUES (${userId}, ${quizId}, ${score}, ${correctAnswers}, ${totalQuestions}, NOW())
    `;

    // 2. Simpan/Update ke tabel data_riwayat_kuis (Untuk status 'Selesai' di UI)
    // Menggunakan ON CONFLICT agar jika user mengerjakan ulang, riwayatnya terupdate ke skor terbaru
    await sql`
      INSERT INTO data_riwayat_kuis (id_pengguna, id_kuis, skor_terakhir, status_selesai, tanggal_terakhir)
      VALUES (${userId}, ${quizId}, ${score}, TRUE, NOW())
      ON CONFLICT (id_pengguna, id_kuis) 
      DO UPDATE SET skor_terakhir = ${score}, tanggal_terakhir = NOW();
    `;

    await sql`COMMIT`;
    res.status(200).json({ message: "Hasil kuis berhasil disimpan!" });
  } catch (error) {
    await sql`ROLLBACK`;
    console.error("Error submit kuis:", error);
    res.status(500).json({ message: "Gagal menyimpan riwayat kuis." });
  }
};

// --- CONTROLLER 4: GET USER PROGRESS (NEW) ---
/**
 * Mengambil riwayat kuis untuk user tertentu
 */
const getUserProgress = async (req, res) => {
  const { userId } = req.user.id;

  try {
    // Ambil riwayat kuis yang pernah dikerjakan dari data_riwayat_kuis
    const history = await sql`
      SELECT id_kuis AS "quizId", skor_terakhir AS score, status_selesai AS completed, tanggal_terakhir AS "completedAt"
      FROM data_riwayat_kuis
      WHERE id_pengguna = ${userId}
    `;

    // Ambil statistik akumulasi (Opsional, sesuaikan dengan kebutuhan userStats di frontend)
    const statsResult = await sql`
      SELECT 
        COUNT(id_kuis)::int AS "totalQuizzes",
        AVG(skor_terakhir)::float AS "averageScore"
      FROM data_riwayat_kuis
      WHERE id_pengguna = ${userId}
    `;

    res.status(200).json({
      history,
      stats: statsResult[0] || { totalQuizzes: 0, averageScore: 0 }
    });
  } catch (error) {
    console.error("Error get progress:", error);
    res.status(500).json({ message: "Gagal mengambil progress user." });
  }
};

export { createKuis, getKuis, submitKuisResult, getUserProgress };