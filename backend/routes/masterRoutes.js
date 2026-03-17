const express = require('express');
const router = express.Router();
const { pool } = require('../db.js');

router.get('/master-yield', async (req, res) => {
  try {
    const { startDate, endDate} = req.query;

    if (!startDate || !endDate) {
      return res
        .status(400)
        .json({ error: 'Missing required query parameters: startDate, endDate' });
    }

    const query =
        `WITH combined AS (
        -- testboard rows take priority
        SELECT
            t.model,
            t.sn,
            t.pn,
            t.workstation_name,
            t.history_station_passing_status AS status,
            date_trunc('week', t.history_station_end_time)::date AS week_of
        FROM testboard_master_log t
        WHERE t.history_station_end_time >= $1
            AND t.history_station_end_time <= $2

        UNION ALL

        -- workstation rows only when no matching testboard row exists
        SELECT
            w.model,
            w.sn,
            w.pn,
            w.workstation_name,
            w.history_station_passing_status AS status,
            date_trunc('week', w.history_station_end_time)::date AS week_of
        FROM workstation_master_log w
        WHERE w.history_station_end_time >= $1
            AND w.history_station_end_time <= $2
            AND NOT EXISTS (
            SELECT 1
            FROM testboard_master_log t
            WHERE t.sn = w.sn
                AND t.workstation_name = w.workstation_name
                AND t.history_station_end_time = w.history_station_end_time
                AND t.history_station_end_time >= $1
                AND t.history_station_end_time <= $2
            )
        )

        SELECT
            --sn,
            pn,
            model,
            to_char(week_of, 'YYYY-MM-DD') AS week_of,

            COUNT(*) FILTER (WHERE workstation_name ILIKE '%REPAIR%')                   AS repair_input,
            COUNT(*) FILTER (WHERE workstation_name ILIKE '%REPAIR%' AND status = 'Pass')  AS repair_output,
            COUNT(*) FILTER (WHERE workstation_name ILIKE '%REPAIR%' AND status = 'Scrap') AS repair_scrap,

            COUNT(*) FILTER (WHERE workstation_name = 'ASSY2')   AS assy2,
            COUNT(*) FILTER (WHERE workstation_name = 'FLA')     AS fla,
            COUNT(*) FILTER (WHERE workstation_name = 'FCT')     AS fct,

            COUNT(*) FILTER (WHERE workstation_name = 'FQC')     AS fqc,
            COUNT(*) FILTER (WHERE workstation_name = 'FQC' AND status = 'Pass') AS fqc_pass,
            COUNT(*) FILTER (WHERE workstation_name = 'FQC' AND status = 'Fail') AS fqc_fail,

            COUNT(*) FILTER (WHERE workstation_name = 'VI1')     AS vi1,
            COUNT(*) FILTER (WHERE workstation_name = 'VI1' AND status = 'Pass') AS vi_pass,
            COUNT(*) FILTER (WHERE workstation_name = 'VI1' AND status = 'Fail') AS vi_Fail,
            COUNT(*) FILTER (WHERE workstation_name = 'RECEIVE') AS receive

        FROM combined
        GROUP BY
            --sn,
            pn,
            model,
            week_of
        ORDER BY
            week_of DESC;`;


    const params = [startDate, endDate];
    const result = await pool.query(query, params);
    return res.json(result.rows);
  } catch (error) {
    console.error('master-query:', error);
    return res.status(500).json({ error: error.message });
  }
});


module.exports = router; 