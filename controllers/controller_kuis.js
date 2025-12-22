import sql from "../config/db.js";
import cloudinary from "../config/cloudinary.js";
import { updateUserStreak, checkAndUnlockBadges } from "../utils/streakHelper.js";

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
 * Menyimpan hasil kuis ke tabel data_hasil_kuis dan data_riwayat_kuis
 */
const submitKuisResult = async (req, res) => {
  const { quizId, score, totalQuestions, timeSpent } = req.body;
  const userId = req.user?.id; // Optional - bisa null untuk guest
  const isGuest = !userId;

  console.log('Submit Quiz Result - Request Body:', { quizId, score, totalQuestions, timeSpent, userId, isGuest });

  if (!quizId || score === undefined || !totalQuestions) {
    console.log('Submit Quiz Result - Data tidak lengkap');
    return res.status(400).json({ message: "Data tidak lengkap" });
  }

  // Jika guest, hanya return hasil tanpa menyimpan ke database
  if (isGuest) {
    console.log('Guest user - returning result without saving');
    
    // Hitung XP untuk ditampilkan (meskipun tidak disimpan)
    const quizInfo = await sql`
      SELECT kesulitan_kuis FROM data_kuis WHERE id_kuis = ${quizId}
    `;
    const difficulty = quizInfo[0]?.kesulitan_kuis || 'easy';
    const correctAnswers = Math.round((score / 100) * totalQuestions);
    const difficultyMultiplier = { 'easy': 1, 'medium': 1.5, 'hard': 2 };
    const baseXP = correctAnswers * 10;
    const xpEarned = Math.round(baseXP * (difficultyMultiplier[difficulty] || 1));

    return res.status(200).json({ 
      message: "Hasil kuis (Guest Mode - tidak disimpan)",
      isGuest: true,
      xpEarned,
      score,
      note: "Login untuk menyimpan hasil dan mendapatkan XP"
    });
  }

  try {
    await sql`BEGIN`;
    console.log('Submit Quiz Result - Transaction started');

    // Ambil info kuis untuk menghitung XP dan kategori
    const quizInfo = await sql`
      SELECT kesulitan_kuis, kategori FROM data_kuis WHERE id_kuis = ${quizId}
    `;

    // Hitung XP berdasarkan score dan difficulty
    const difficulty = quizInfo[0]?.kesulitan_kuis || 'easy';
    const correctAnswers = Math.round((score / 100) * totalQuestions);
    
    // Formula XP: (jawaban benar * 10) * multiplier kesulitan
    const difficultyMultiplier = {
      'easy': 1,
      'medium': 1.5,
      'hard': 2
    };
    const baseXP = correctAnswers * 10;
    const xpEarned = Math.round(baseXP * (difficultyMultiplier[difficulty] || 1));
    
    console.log('XP Calculation:', { correctAnswers, difficulty, baseXP, xpEarned });

    // 1. Simpan ke tabel data_hasil_kuis (Detail skor pengerjaan)
    const resultInsert = await sql`
      INSERT INTO data_hasil_kuis (
        id_pengguna, 
        id_kuis, 
        tanggal_selesai, 
        total_waktu_pengerjaan_menit, 
        total_skor_user, 
        status_pengerjaan
      )
      VALUES (
        ${userId}, 
        ${quizId}, 
        NOW(), 
        ${timeSpent || 0}, 
        ${score}, 
        'selesai'
      )
      RETURNING id_hasil_kuis
    `;

    // 2. Ambil id_progres user
    const progressResult = await sql`
      SELECT id_progres FROM data_progres_pengguna WHERE id_pengguna = ${userId}
    `;

    if (progressResult.length > 0) {
      const idProgres = progressResult[0].id_progres;

      // 3. Tambahkan ke riwayat secara atomik (hindari double-count jika request masuk 2x)
      const insertedHistory = await sql`
        INSERT INTO data_riwayat_kuis (id_progres, id_kuis)
        VALUES (${idProgres}, ${quizId})
        ON CONFLICT (id_progres, id_kuis) DO NOTHING
        RETURNING id_kuis
      `;

      const isFirstTime = insertedHistory.length > 0;

      // 5. Update progress pengguna (increment kuis_diselesaikan dan tambah XP)
      const currentProgress = await sql`
        SELECT xp_pengguna, level_pengguna FROM data_progres_pengguna 
        WHERE id_pengguna = ${userId}
      `;

      const currentXP = currentProgress[0]?.xp_pengguna || 0;
      const currentLevel = currentProgress[0]?.level_pengguna || 1;
      const newXP = currentXP + xpEarned;

      // Formula level yang konsisten: Level 1 = 0-99 XP, Level 2 = 100-299 XP, Level 3 = 300-599 XP, dst
      // XP requirement untuk level N = 100 * N
      // Total XP untuk mencapai level N = 100 * (N-1) * N / 2
      let newLevel = 1;
      let totalXPNeeded = 0;
      
      while (totalXPNeeded <= newXP) {
        totalXPNeeded += (newLevel * 100);
        if (totalXPNeeded <= newXP) {
          newLevel++;
        }
      }
      
      const leveledUp = newLevel > currentLevel;

      if (isFirstTime) {
        await sql`
          UPDATE data_progres_pengguna 
          SET 
            kuis_diselesaikan = kuis_diselesaikan + 1,
            xp_pengguna = ${newXP},
            level_pengguna = ${newLevel}
          WHERE id_pengguna = ${userId}
        `;
      } else {
        await sql`
          UPDATE data_progres_pengguna 
          SET 
            xp_pengguna = ${newXP},
            level_pengguna = ${newLevel}
          WHERE id_pengguna = ${userId}
        `;
      }

      console.log('Progress Updated:', { 
        oldXP: currentXP, 
        newXP, 
        oldLevel: currentLevel, 
        newLevel, 
        leveledUp 
      });

      // 6. Update literacy skills - hanya fact_checking dan analisis_kritis
      // HANYA jika ini pertama kali mengerjakan kuis ini
      // Menulis ringkasan akan diupdate saat user membuat artikel
      if (isFirstTime) {
        // Peningkatan skill: range 1-3 poin berdasarkan skor dan kesulitan
        const skillDifficultyMultiplier = {
          'easy': 1,
          'medium': 1.5,
          'hard': 2
        };
        
        // Formula baru: 1 + (score/100 * 2) * multiplier
        // Hasil: 1-3 poin (1 poin minimum, 3 poin maksimal untuk hard quiz dengan score 100)
        const baseSkillIncrease = 1 + (score / 100) * 2; // 1-3 poin base
        const skillIncrease = Math.min(3, baseSkillIncrease * (skillDifficultyMultiplier[difficulty] || 1));
        
        console.log('Literacy Skills Update (First Time):', { 
          score, 
          difficulty, 
          skillIncrease: skillIncrease.toFixed(2),
          isFirstTime 
        });

        // Update hanya fact_checking dan analisis_kritis
        await sql`
          UPDATE data_detail_kemampuan_literasi
          SET 
            analisis_kritis = LEAST(100, analisis_kritis + ${skillIncrease}),
            fact_checking = LEAST(100, fact_checking + ${skillIncrease})
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
          WHERE dpp.id_pengguna = ${userId}
        `;

        console.log('Literacy skills updated successfully');
      } else {
        console.log('Quiz retake - skills not updated');
      }
      
      // Update streak saat user menyelesaikan kuis
      await updateUserStreak(userId);
      
      // Cek dan unlock badge jika memenuhi kriteria
      const badgeResult = await checkAndUnlockBadges(userId);
      console.log('Badge check result:', badgeResult);
    }

    await sql`COMMIT`;
    res.status(200).json({ 
      message: "Hasil kuis berhasil disimpan!",
      resultId: resultInsert[0].id_hasil_kuis,
      xpEarned,
      newXP: progressResult.length > 0 ? (progressResult[0].xp_pengguna || 0) + xpEarned : xpEarned,
      leveledUp: progressResult.length > 0 ? Math.floor(((progressResult[0].xp_pengguna || 0) + xpEarned) / 100) + 1 > (progressResult[0].level_pengguna || 1) : false
    });
  } catch (error) {
    await sql`ROLLBACK`;
    console.error("Error submit kuis:", error);
    res.status(500).json({ message: "Gagal menyimpan hasil kuis.", error: error.message });
  }
};

// --- CONTROLLER 4: GET USER COMPLETED QUIZZES (NEW) ---
/**
 * Mengambil daftar kuis yang sudah dikerjakan user
 */
const getUserCompletedQuizzes = async (req, res) => {
  const userId = req.user.id;

  try {
    // Ambil id_progres user
    const progressResult = await sql`
      SELECT id_progres FROM data_progres_pengguna WHERE id_pengguna = ${userId}
    `;

    if (progressResult.length === 0) {
      return res.status(200).json({ completedQuizzes: [] });
    }

    const idProgres = progressResult[0].id_progres;

    // Ambil daftar kuis yang sudah dikerjakan dari data_riwayat_kuis
    const completedQuizzes = await sql`
      SELECT rk.id_kuis AS "quizId"
      FROM data_riwayat_kuis rk
      WHERE rk.id_progres = ${idProgres}
    `;

    // Ubah ke format object untuk mudah dicek di frontend
    const completedQuizzesMap = {};
    completedQuizzes.forEach(item => {
      completedQuizzesMap[item.quizId] = true;
    });

    res.status(200).json({ completedQuizzes: completedQuizzesMap });
  } catch (error) {
    console.error("Error get completed quizzes:", error);
    res.status(500).json({ message: "Gagal mengambil daftar kuis yang sudah dikerjakan." });
  }
};

// --- CONTROLLER 5: GET USER QUIZ HISTORY (NEW) ---
/**
 * Mengambil riwayat detail hasil kuis user
 */
const getUserQuizHistory = async (req, res) => {
  const userId = req.user.id;

  try {
    // Ambil riwayat hasil kuis dengan detail kuis
    const history = await sql`
      SELECT 
        hk.id_hasil_kuis AS id,
        hk.id_kuis AS "quizId",
        k.judul_kuis AS "quizTitle",
        k.gambar AS "quizImage",
        hk.total_skor_user AS score,
        hk.tanggal_selesai AS "completedAt",
        hk.total_waktu_pengerjaan_menit AS "timeSpent"
      FROM data_hasil_kuis hk
      JOIN data_kuis k ON k.id_kuis = hk.id_kuis
      WHERE hk.id_pengguna = ${userId}
      ORDER BY hk.tanggal_selesai DESC
    `;

    // Ambil statistik
    const statsResult = await sql`
      SELECT 
        COUNT(*)::int AS "totalQuizzes",
        AVG(total_skor_user)::float AS "averageScore"
      FROM data_hasil_kuis
      WHERE id_pengguna = ${userId}
    `;

    res.status(200).json({
      history,
      stats: statsResult[0] || { totalQuizzes: 0, averageScore: 0 }
    });
  } catch (error) {
    console.error("Error get quiz history:", error);
    res.status(500).json({ message: "Gagal mengambil riwayat kuis." });
  }
};

const updateKuisMetadata = async (req, res) => {
  const { id } = req.params;
  const userId = req.user.id;
  const { title, description, category, difficulty, status } = req.body;

  try {
    const ownerCheck = await sql`
      SELECT id_pengguna
      FROM data_kuis
      WHERE id_kuis = ${id}
      LIMIT 1
    `;

    if (ownerCheck.length === 0) {
      return res.status(404).json({ message: "Kuis tidak ditemukan" });
    }

    if (ownerCheck[0].id_pengguna !== userId) {
      return res.status(403).json({ message: "Akses ditolak" });
    }

    await sql`
      UPDATE data_kuis
      SET
        judul_kuis = COALESCE(${title}, judul_kuis),
        deskripsi = COALESCE(${description}, deskripsi),
        kategori = COALESCE(${category}, kategori),
        kesulitan_kuis = COALESCE(${difficulty}, kesulitan_kuis),
        status = COALESCE(${status}, status)
      WHERE id_kuis = ${id}
    `;

    res.json({ message: "Kuis berhasil diperbarui" });
  } catch (error) {
    console.error("Error updating quiz metadata:", error);
    res.status(500).json({ message: "Gagal memperbarui kuis" });
  }
};

const deleteMyKuis = async (req, res) => {
  const { id } = req.params;
  const userId = req.user.id;

  try {
    const ownerCheck = await sql`
      SELECT id_pengguna
      FROM data_kuis
      WHERE id_kuis = ${id}
      LIMIT 1
    `;

    if (ownerCheck.length === 0) {
      return res.status(404).json({ message: "Kuis tidak ditemukan" });
    }

    if (ownerCheck[0].id_pengguna !== userId) {
      return res.status(403).json({ message: "Akses ditolak" });
    }

    await sql`BEGIN`;

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

    await sql`COMMIT`;

    res.json({ message: "Kuis berhasil dihapus" });
  } catch (error) {
    await sql`ROLLBACK`;
    console.error("Error deleting quiz:", error);
    res.status(500).json({ message: "Gagal menghapus kuis" });
  }
};

export {
  createKuis,
  getKuis,
  submitKuisResult,
  getUserCompletedQuizzes,
  getUserQuizHistory,
  updateKuisMetadata,
  deleteMyKuis,
};