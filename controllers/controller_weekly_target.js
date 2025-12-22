import sql from "../config/db.js";

const hasWeeklyTargetBaselineColumns = async () => {
  const rows = await sql`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'data_target_mingguan'
      AND column_name IN (
        'baseline_artikel_dibaca',
        'baseline_waktu_membaca',
        'baseline_kuis_diselesaikan'
      )
  `;

  const cols = new Set(rows.map((r) => r.column_name));
  return (
    cols.has("baseline_artikel_dibaca") &&
    cols.has("baseline_waktu_membaca") &&
    cols.has("baseline_kuis_diselesaikan")
  );
};

const getWeekNumber = (date) => {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
};

export const createWeeklyTarget = async (req, res) => {
  try {
    const { 
      startDate, 
      endDate,
      targetArticles = 5,
      targetHoursMinutes = 180,
      targetQuizzes = 5
    } = req.body;

    if (!startDate || !endDate) {
      return res.status(400).json({ 
        message: 'startDate dan endDate wajib diisi' 
      });
    }

    const startDateOnly = String(startDate || "").slice(0, 10);
    const endDateOnly = String(endDate || "").slice(0, 10);

    const dateRe = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRe.test(startDateOnly) || !dateRe.test(endDateOnly)) {
      return res.status(400).json({ message: 'startDate atau endDate tidak valid' });
    }

    const start = new Date(startDateOnly);
    const end = new Date(endDateOnly);

    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      return res.status(400).json({ message: 'startDate atau endDate tidak valid' });
    }

    const existingTargets = await sql`
      SELECT * FROM data_target_mingguan
      WHERE tanggal_mulai = ${startDateOnly}::date AND tanggal_selesai = ${endDateOnly}::date
      LIMIT 1
    `;

    if (existingTargets.length > 0) {
      return res.status(400).json({ 
        message: 'Target mingguan untuk periode ini sudah dibuat',
        existingTarget: existingTargets[0]
      });
    }

    const allUsers = await sql`
      SELECT id_pengguna FROM pengguna WHERE role_pengguna = 'user'
    `;

    const baselineColumnsAvailable = await hasWeeklyTargetBaselineColumns();

    const insertedTargets = [];
    for (const user of allUsers) {
      if (baselineColumnsAvailable) {
        const [userProgress] = await sql`
          SELECT artikel_dibaca, waktu_membaca, kuis_diselesaikan
          FROM data_progres_pengguna
          WHERE id_pengguna = ${user.id_pengguna}
          LIMIT 1
        `;

        const baselineArticles = userProgress?.artikel_dibaca ?? 0;
        const baselineMinutes = userProgress?.waktu_membaca ?? 0;
        const baselineQuizzes = userProgress?.kuis_diselesaikan ?? 0;

        const [target] = await sql`
          INSERT INTO data_target_mingguan (
            id_pengguna, id_admin_pembuat,
            tanggal_mulai, tanggal_selesai,
            target_artikel, target_waktu_baca_menit, target_kuis,
            baseline_artikel_dibaca, baseline_waktu_membaca, baseline_kuis_diselesaikan,
            status_target
          ) VALUES (
            ${user.id_pengguna}, ${req.user.id},
            ${startDateOnly}::date, ${endDateOnly}::date,
            ${targetArticles}, ${targetHoursMinutes}, ${targetQuizzes},
            ${baselineArticles}, ${baselineMinutes}, ${baselineQuizzes},
            'active'
          )
          RETURNING *
        `;
        insertedTargets.push(target);
      } else {
        const [target] = await sql`
          INSERT INTO data_target_mingguan (
            id_pengguna, id_admin_pembuat,
            tanggal_mulai, tanggal_selesai,
            target_artikel, target_waktu_baca_menit, target_kuis,
            status_target
          ) VALUES (
            ${user.id_pengguna}, ${req.user.id},
            ${startDateOnly}::date, ${endDateOnly}::date,
            ${targetArticles}, ${targetHoursMinutes}, ${targetQuizzes},
            'active'
          )
          RETURNING *
        `;
        insertedTargets.push(target);
      }
    }

    res.status(201).json({
      message: `Target mingguan berhasil dibuat untuk ${allUsers.length} pengguna`,
      targetArticles,
      targetHoursMinutes,
      targetQuizzes,
      startDate: start,
      endDate: end,
      totalUsers: allUsers.length
    });
  } catch (error) {
    console.error('Error creating weekly target:', error);
    res.status(500).json({ 
      message: 'Gagal membuat target mingguan', 
      error: error.message 
    });
  }
};

export const getAllWeeklyTargets = async (req, res) => {
  try {
    const targets = await sql`
      SELECT 
        dt.tanggal_mulai,
        dt.tanggal_selesai,
        dt.target_artikel,
        dt.target_waktu_baca_menit,
        dt.target_kuis,
        p.nama_pengguna as creator_name,
        COUNT(DISTINCT dt.id_pengguna) as total_users,
        SUM(CASE WHEN dt.status_target = 'completed' THEN 1 ELSE 0 END) as completed_users
      FROM data_target_mingguan dt
      LEFT JOIN pengguna p ON dt.id_admin_pembuat = p.id_pengguna
      GROUP BY dt.tanggal_mulai, dt.tanggal_selesai, dt.target_artikel, 
               dt.target_waktu_baca_menit, dt.target_kuis, p.nama_pengguna
      ORDER BY dt.tanggal_mulai DESC
    `;

    const nowDate = new Date();
    nowDate.setHours(0, 0, 0, 0);

    const formattedTargets = targets.map(t => {
      const startDateObj = new Date(t.tanggal_mulai);
      startDateObj.setHours(0, 0, 0, 0);
      const endDateObj = new Date(t.tanggal_selesai);
      endDateObj.setHours(0, 0, 0, 0);

      const totalUsers = parseInt(t.total_users);
      const completedUsers = parseInt(t.completed_users || 0);

      let status = 'inactive';
      if (totalUsers > 0 && completedUsers >= totalUsers) {
        status = 'completed';
      } else if (nowDate >= startDateObj && nowDate <= endDateObj) {
        status = 'active';
      }

      return {
        startDate: t.tanggal_mulai,
        endDate: t.tanggal_selesai,
        targetArticles: t.target_artikel,
        targetHoursMinutes: t.target_waktu_baca_menit,
        targetQuizzes: t.target_kuis,
        status,
        createdBy: t.creator_name,
        totalUsers,
        completedUsers
      };
    });

    res.json({ targets: formattedTargets });
  } catch (error) {
    console.error('Error fetching weekly targets:', error);
    res.status(500).json({ message: 'Gagal mengambil data target mingguan' });
  }
};

export const deleteWeeklyTarget = async (req, res) => {
  try {
    const { startDate } = req.params;

    const startDateOnly = String(startDate || "").slice(0, 10);

    await sql`
      DELETE FROM data_target_mingguan
      WHERE tanggal_mulai = ${startDateOnly}::date
    `;

    res.json({ message: 'Target mingguan berhasil dihapus' });
  } catch (error) {
    console.error('Error deleting weekly target:', error);
    res.status(500).json({ message: 'Gagal menghapus target mingguan' });
  }
};

export const getCurrentWeekTarget = async (req, res) => {
  try {
    const now = new Date();

    const baselineColumnsAvailable = await hasWeeklyTargetBaselineColumns();
    
    const [currentTarget] = await sql`
      SELECT * FROM data_target_mingguan
      WHERE id_pengguna = ${req.user.id}
        AND tanggal_mulai <= CURRENT_DATE
        AND tanggal_selesai >= CURRENT_DATE
      ORDER BY tanggal_mulai DESC
      LIMIT 1
    `;

    if (!currentTarget) {
      return res.json({ 
        message: 'Belum ada target untuk minggu ini', 
        target: null,
        progress: null
      });
    }

    const [userProgress] = await sql`
      SELECT * FROM data_progres_pengguna
      WHERE id_pengguna = ${req.user.id}
    `;

    const articlesRead = userProgress?.artikel_dibaca || 0;
    const minutesRead = userProgress?.waktu_membaca || 0;
    const quizzesCompleted = userProgress?.kuis_diselesaikan || 0;

    const baselineArticles = currentTarget.baseline_artikel_dibaca ?? 0;
    const baselineMinutes = currentTarget.baseline_waktu_membaca ?? 0;
    const baselineQuizzes = currentTarget.baseline_kuis_diselesaikan ?? 0;

    const effectiveBaselineArticles = baselineColumnsAvailable ? baselineArticles : 0;
    const effectiveBaselineMinutes = baselineColumnsAvailable ? baselineMinutes : 0;
    const effectiveBaselineQuizzes = baselineColumnsAvailable ? baselineQuizzes : 0;

    const weeklyArticlesRead = Math.max(0, articlesRead - effectiveBaselineArticles);
    const weeklyMinutesRead = Math.max(0, minutesRead - effectiveBaselineMinutes);
    const weeklyQuizzesCompleted = Math.max(0, quizzesCompleted - effectiveBaselineQuizzes);

    const safePct = (done, total) => {
      if (!total || total <= 0) return 0;
      return Math.min((done / total) * 100, 100);
    };

    const articleProgress = safePct(weeklyArticlesRead, currentTarget.target_artikel);
    const timeProgress = safePct(weeklyMinutesRead, currentTarget.target_waktu_baca_menit);
    const quizProgress = safePct(weeklyQuizzesCompleted, currentTarget.target_kuis);
    const completionPercentage = ((articleProgress + timeProgress + quizProgress) / 3).toFixed(2);

    const isCompleted =
      weeklyArticlesRead >= currentTarget.target_artikel &&
      weeklyMinutesRead >= currentTarget.target_waktu_baca_menit &&
      weeklyQuizzesCompleted >= currentTarget.target_kuis;

    res.json({
      target: {
        id: currentTarget.id_target,
        startDate: currentTarget.tanggal_mulai,
        endDate: currentTarget.tanggal_selesai,
        targetArticles: currentTarget.target_artikel,
        targetMinutesRead: currentTarget.target_waktu_baca_menit,
        targetQuizzes: currentTarget.target_kuis,
        status: currentTarget.status_target
      },
      progress: {
        articlesRead: weeklyArticlesRead,
        minutesRead: weeklyMinutesRead,
        quizzesCompleted: weeklyQuizzesCompleted,
        completionPercentage,
        isCompleted
      }
    });
  } catch (error) {
    console.error('Error fetching current target:', error);
    res.status(500).json({ message: 'Gagal mengambil target mingguan' });
  }
};

export const updateProgress = async (req, res) => {
  try {
    const { type, value } = req.body;
    
    const now = new Date();

    const baselineColumnsAvailable = await hasWeeklyTargetBaselineColumns();
    const [currentTarget] = await sql`
      SELECT * FROM data_target_mingguan
      WHERE id_pengguna = ${req.user.id}
        AND tanggal_mulai <= CURRENT_DATE
        AND tanggal_selesai >= CURRENT_DATE
      LIMIT 1
    `;

    if (!currentTarget) {
      return res.status(404).json({ message: 'Tidak ada target aktif' });
    }

    if (currentTarget.status_target === 'completed') {
      return res.status(400).json({ message: 'Target sudah selesai' });
    }

    let updateQuery;
    switch (type) {
      case 'article':
        updateQuery = sql`
          UPDATE data_progres_pengguna
          SET artikel_dibaca = artikel_dibaca + 1
          WHERE id_pengguna = ${req.user.id}
          RETURNING *
        `;
        break;
      case 'hours':
        const minutes = Math.round(parseFloat(value || 0) * 60);
        updateQuery = sql`
          UPDATE data_progres_pengguna
          SET waktu_membaca = waktu_membaca + ${minutes}
          WHERE id_pengguna = ${req.user.id}
          RETURNING *
        `;
        break;
      case 'quiz':
        updateQuery = sql`
          UPDATE data_progres_pengguna
          SET kuis_diselesaikan = kuis_diselesaikan + 1
          WHERE id_pengguna = ${req.user.id}
          RETURNING *
        `;
        break;
      default:
        return res.status(400).json({ message: 'Tipe progress tidak valid' });
    }

    const [updatedProgress] = await updateQuery;

    const articlesRead = updatedProgress.artikel_dibaca;
    const minutesRead = updatedProgress.waktu_membaca;
    const quizzesCompleted = updatedProgress.kuis_diselesaikan;

    const baselineArticles = currentTarget.baseline_artikel_dibaca ?? 0;
    const baselineMinutes = currentTarget.baseline_waktu_membaca ?? 0;
    const baselineQuizzes = currentTarget.baseline_kuis_diselesaikan ?? 0;

    const effectiveBaselineArticles = baselineColumnsAvailable ? baselineArticles : 0;
    const effectiveBaselineMinutes = baselineColumnsAvailable ? baselineMinutes : 0;
    const effectiveBaselineQuizzes = baselineColumnsAvailable ? baselineQuizzes : 0;

    const weeklyArticlesRead = Math.max(0, articlesRead - effectiveBaselineArticles);
    const weeklyMinutesRead = Math.max(0, minutesRead - effectiveBaselineMinutes);
    const weeklyQuizzesCompleted = Math.max(0, quizzesCompleted - effectiveBaselineQuizzes);

    const safePct = (done, total) => {
      if (!total || total <= 0) return 0;
      return Math.min((done / total) * 100, 100);
    };

    const articleProgress = safePct(weeklyArticlesRead, currentTarget.target_artikel);
    const timeProgress = safePct(weeklyMinutesRead, currentTarget.target_waktu_baca_menit);
    const quizProgress = safePct(weeklyQuizzesCompleted, currentTarget.target_kuis);
    const completionPercentage = ((articleProgress + timeProgress + quizProgress) / 3).toFixed(2);

    const isCompleted =
      weeklyArticlesRead >= currentTarget.target_artikel &&
      weeklyMinutesRead >= currentTarget.target_waktu_baca_menit &&
      weeklyQuizzesCompleted >= currentTarget.target_kuis;

    if (isCompleted && currentTarget.status_target !== 'completed') {
      await sql`
        UPDATE data_target_mingguan
        SET status_target = 'completed'
        WHERE id_target = ${currentTarget.id_target}
      `;
    }

    res.json({
      message: 'Progress berhasil diperbarui',
      progress: {
        articlesRead: weeklyArticlesRead,
        minutesRead: weeklyMinutesRead,
        quizzesCompleted: weeklyQuizzesCompleted,
        completionPercentage,
        isCompleted
      },
      newlyCompleted: isCompleted && currentTarget.status_target !== 'completed'
    });
  } catch (error) {
    console.error('Error updating progress:', error);
    res.status(500).json({ message: 'Gagal memperbarui progress' });
  }
};

export const getMyProgressHistory = async (req, res) => {
  try {
    const progressHistory = await sql`
      SELECT 
        dt.*,
        dp.artikel_dibaca,
        dp.waktu_membaca,
        dp.kuis_diselesaikan
      FROM data_target_mingguan dt
      LEFT JOIN data_progres_pengguna dp ON dt.id_pengguna = dp.id_pengguna
      WHERE dt.id_pengguna = ${req.user.id}
      ORDER BY dt.tanggal_mulai DESC
      LIMIT 10
    `;

    const formatted = progressHistory.map(p => {
      const articlesRead = p.artikel_dibaca || 0;
      const minutesRead = p.waktu_membaca || 0;
      const quizzesCompleted = p.kuis_diselesaikan || 0;

      const articleProgress = (articlesRead / p.target_artikel) * 100;
      const timeProgress = (minutesRead / p.target_waktu_baca_menit) * 100;
      const quizProgress = (quizzesCompleted / p.target_kuis) * 100;
      const totalProgress = (articleProgress + timeProgress + quizProgress) / 3;

      return {
        id: p.id_target,
        target: {
          startDate: p.tanggal_mulai,
          endDate: p.tanggal_selesai,
          targetArticles: p.target_artikel,
          targetMinutesRead: p.target_waktu_baca_menit,
          targetQuizzes: p.target_kuis,
          status: p.status_target
        },
        progress: {
          articlesRead,
          minutesRead,
          quizzesCompleted,
          completionPercentage: Math.min(totalProgress, 100).toFixed(2),
          isCompleted: p.status_target === 'completed'
        }
      };
    });

    res.json({ progressHistory: formatted });
  } catch (error) {
    console.error('Error fetching progress history:', error);
    res.status(500).json({ message: 'Gagal mengambil riwayat progress' });
  }
};
