import cloudinary from "../config/cloudinary.js";
import sql from "../config/db.js";
import fs from "fs";

// Fungsi untuk membuat event (dari langkah sebelumnya)
const createEvent = async (req, res) => {
  const id_pengguna = req.user.id;
  const { title, description, date, time, type, price, tags } = req.body;
  const file = req.file;

  if (!title || !description || !date || !time || !type || !price || !file) {
    return res.status(400).json({ message: "Semua field wajib diisi" });
  }

  const eventDateTime = new Date(`${date}T${time}:00`);
  if (eventDateTime < new Date()) {
    return res.status(400).json({ message: "Tanggal event tidak valid" });
  }

  try {
    /* =========================
       1. Upload gambar
    ========================= */
    const imageUrl = await new Promise((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        { folder: "events" },
        (err, result) => {
          if (err) reject(err);
          else resolve(result.secure_url);
        }
      );
      stream.end(file.buffer);
    });

    /* =========================
       2. INSERT / GET penyelenggara (1 QUERY)
    ========================= */
    const penyelenggara = await sql`
      WITH existing AS (
        SELECT id_penyelenggara
        FROM data_penyelenggara
        WHERE id_pengguna = ${id_pengguna}
      ),
      inserted AS (
        INSERT INTO data_penyelenggara (
          id_pengguna,
          nama_penyelenggara,
          gambar_penyelenggara
        )
        SELECT
          u.id_pengguna,
          u.nama_pengguna,
          u.foto_pengguna
        FROM pengguna u
        WHERE u.id_pengguna = ${id_pengguna}
          AND NOT EXISTS (SELECT 1 FROM existing)
        RETURNING id_penyelenggara
      )
      SELECT id_penyelenggara FROM inserted
      UNION ALL
      SELECT id_penyelenggara FROM existing
      LIMIT 1;
    `;

    const id_penyelenggara = penyelenggara[0].id_penyelenggara;

    /* =========================
       3. Parsing harga
    ========================= */
    let biaya = 0;
    if (price.toLowerCase() !== "gratis") {
      biaya = Number(price.replace(/\D/g, "")) || 0;
    }

    const fullTimestamp = `${date} ${time}:00`;

    /* =========================
       4. INSERT EVENT (FK AMAN)
    ========================= */
    const event = await sql`
      INSERT INTO data_event (
        id_penyelenggara,
        judul_event,
        deskripsi,
        gambar,
        jenis_acara,
        tanggal_acara,
        waktu_acara,
        biaya_acara,
        total_partisipan,
        status_acara,
        partisipan
      )
      VALUES (
        ${id_penyelenggara},
        ${title},
        ${description},
        ${imageUrl},
        ${type},
        ${fullTimestamp},
        ${fullTimestamp},
        ${biaya},
        1000,
        'upcoming',
        0
      )
      RETURNING id_event;
    `;

    const id_event = event[0].id_event;

    /* =========================
       5. Tags (optional)
    ========================= */
    /* =========================
   5. Tags (SAFE & CLEAN)
========================= */
    if (tags) {
      let tagList = [];

      if (tags.trim().startsWith("[")) {
        tagList = JSON.parse(tags);
      } else {
        tagList = tags
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean);
      }

      for (const tag of tagList) {
        // upsert tag (ANTI DUPLIKAT)
        const tagResult = await sql`
  INSERT INTO data_tag (nama_tag)
  VALUES (${tag})
  ON CONFLICT (nama_tag)
  DO UPDATE SET nama_tag = EXCLUDED.nama_tag
  RETURNING id_tag;
`;

        const id_tag = tagResult[0].id_tag;

        // relasi event-tag (ANTI DUPLIKAT)
        await sql`
      INSERT INTO data_tag_event (id_event, id_tag)
      VALUES (${id_event}, ${id_tag})
      ON CONFLICT DO NOTHING;
    `;
      }
    }
    res.status(201).json({
      message: "Event berhasil dibuat",
      id_event,
      id_penyelenggara,
      imageUrl,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({
      message: "Gagal membuat event",
      error: err.message,
    });
  }
};

// Fungsi untuk mengambil event (getEvent)
const getEvent = async (req, res) => {
  try {
    const rawEvents = await sql`
      SELECT
        de.id_event,
        de.judul_event,
        de.deskripsi,
        de.gambar AS image,
        de.jenis_acara AS type,
        de.tanggal_acara,
        de.biaya_acara AS price_raw,
        de.partisipan,
        de.status_acara AS status,

        -- Ambil Nama dan Foto langsung dari tabel Pengguna
        u.nama_pengguna AS speaker,
        u.foto_pengguna AS speaker_image_url, 

        ARRAY_REMOVE(ARRAY_AGG(dt.nama_tag), NULL) AS tags

      FROM data_event de
      JOIN data_penyelenggara dp
        ON de.id_penyelenggara = dp.id_penyelenggara
      JOIN pengguna u
        ON dp.id_pengguna = u.id_pengguna
      LEFT JOIN data_tag_event dte
        ON de.id_event = dte.id_event
      LEFT JOIN data_tag dt
        ON dte.id_tag = dt.id_tag

      GROUP BY
        de.id_event,
        u.nama_pengguna,
        u.foto_pengguna
        
      ORDER BY de.tanggal_acara DESC;
    `;

    const formattedEvents = rawEvents.map((event) => {
      const dateTime = new Date(event.tanggal_acara);

      const date = dateTime.toLocaleDateString("id-ID", {
        day: "numeric",
        month: "long",
        year: "numeric",
      });

      const time =
        dateTime.toLocaleTimeString("id-ID", {
          hour: "2-digit",
          minute: "2-digit",
        }) + " WIB";

      let price;
      if (event.price_raw === 0 || event.price_raw === 0.0) {
        price = "Gratis";
      } else {
        price =
          "Rp " +
          Number(event.price_raw).toLocaleString("id-ID", {
            minimumFractionDigits: 0,
            maximumFractionDigits: 0,
          });
      }

      const participantsFormatted =
        event.partisipan >= 100
          ? `${Math.floor(event.partisipan / 10) * 10}+`
          : String(event.partisipan);

      return {
        id: event.id_event,
        title: event.judul_event,
        description: event.deskripsi,
        date,
        time,
        type: event.type,
        category: event.tags.length > 0 ? event.tags[0] : (event.type.charAt(0).toUpperCase() + event.type.slice(1)),
        speaker: event.speaker,
        speakerImage: event.speaker_image_url, // <--- PASTIKAN BARIS INI ADA
        price,
        participants: participantsFormatted,
        image: event.image,
        status: event.status,
        difficulty: "Semua Level",
        tags: event.tags,
      };
    });

    res.status(200).json({
      message: "Data event berhasil diambil.",
      events: formattedEvents,
    });
  } catch (error) {
    console.error("Kesalahan saat mengambil event:", error);
    res.status(500).json({
      message: "Gagal mengambil event karena kesalahan server.",
      error: error.message,
    });
  }
};

const registerEvent = async (req, res) => {
  const { id_event } = req.params;
  const id_pengguna = req.user.id; // Diambil dari middleware authenticate
  const tanggal_daftar = new Date().toISOString().split('T')[0];

  try {
    // 1. Cek apakah user sudah terdaftar
    const checkExist = await pool.query(
      'SELECT * FROM data_partisipasi_event WHERE id_event = $1 AND id_pengguna = $2',
      [id_event, id_pengguna]
    );

    if (checkExist.rows.length > 0) {
      return res.status(400).json({ message: 'Kamu sudah terdaftar di event ini' });
    }

    // 2. Ambil id_progres dari pengguna untuk riwayat
    const progres = await pool.query(
      'SELECT id_progres FROM data_progres_pengguna WHERE id_pengguna = $1',
      [id_pengguna]
    );
    const id_progres = progres.rows[0].id_progres;

    // 3. Masukkan ke tabel partisipasi & riwayat (Gunakan Transaction agar aman)
    await pool.query('BEGIN');
    
    // Simpan ke partisipasi (untuk status pembayaran)
    await pool.query(
      'INSERT INTO data_partisipasi_event (id_event, id_pengguna, tanggal_daftar, status_pembayaran) VALUES ($1, $2, $3, $4)',
      [id_event, id_pengguna, tanggal_daftar, 'lunas'] // default lunas jika event gratis
    );

    // Simpan ke riwayat (agar muncul di profil)
    await pool.query(
      'INSERT INTO data_riwayat_event (id_progres, id_event) VALUES ($1, $2)',
      [id_progres, id_event]
    );
    
    // Update jumlah partisipan di tabel event
    await pool.query(
      'UPDATE data_event SET partisipan = partisipan + 1 WHERE id_event = $1',
      [id_event]
    );

    await pool.query('COMMIT');

    res.status(201).json({ message: 'Berhasil mendaftar event' });
  } catch (error) {
    await pool.query('ROLLBACK');
    console.error(error);
    res.status(500).json({ message: 'Gagal mendaftar event' });
  }
};

const getUserRegisteredEvents = async (req, res) => {
  const id_pengguna = req.user.id;

  try {
    const result = await pool.query(
      `SELECT e.* FROM data_event e
       JOIN data_partisipasi_event p ON e.id_event = p.id_event
       WHERE p.id_pengguna = $1`,
      [id_pengguna]
    );
    res.status(200).json(result.rows);
  } catch (error) {
    res.status(500).json({ message: 'Gagal mengambil data event user' });
  }
};

export { createEvent, getEvent, getUserRegisteredEvents, registerEvent };
