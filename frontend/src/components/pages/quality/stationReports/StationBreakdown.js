import { useEffect, useState, useMemo, useCallback } from 'react';
import { Box, TextField, MenuItem, Paper, Typography, TableContainer,
    Table, TableHead, TableRow, TableBody, TableCell, Button
 } from '@mui/material';
import { useTheme } from '@mui/material';
import { useLocation } from 'react-router-dom';
import 'react-datepicker/dist/react-datepicker.css';

// Page components
import { Header } from '../../../pagecomp/Header.jsx';
import { DateRange } from '../../../pagecomp/DateRange.jsx';
import { NumberRange } from '../../../pagecomp/NumberRange.jsx';
import { TestStationChart } from '../../../charts/TestStationChart.js';
import { PieChart } from '../../../charts/PieChart.js';

// Hooks

// Utilities & Styles
import { normalizeDate,getInitialStartDate } from '../../../../utils/dateUtils.js';
import { toolbarStyle } from '../../../theme/themes.js';
import { useGlobalSettings } from '../../../../data/GlobalSettingsContext.js';
import { fetchDiveData } from '../../../../utils/queryUtils.js';

// Check for environment variable for API base
const API_BASE = process.env.REACT_APP_API_BASE;
if (!API_BASE) {
  console.error('REACT_APP_API_BASE environment variable is not set! Please set it in your .env file.');
}

const maxDescLength = 50;

const codeActions = [
    { codes: [665,220,143,77,0o3,0o0,551,514,773,516,852,12,2], message: "False Failure / Re-Test" },
    { codes: [511,363,317,229,319,167,321,316,320,97,818,83], message: "Scrap" },
    { codes: [139,445,534,538,999,14,6,679,600,709,140,541,288,1,281,603,280,41], message: "Simple / Debug" },
    { codes: [301,539], message: "Hard / Component Repair" },
    { codes: [501], message: "Customer Support Req / Notify Customer" },
    { codes: [1000], message: "Other Issue / Failure Analysis" },
];

const getCodeAction = (shortCode) => {
    let num = Number(shortCode);
    if(shortCode === 'EC-WS' || shortCode === '-WS'){num = 1000}
    const match = codeActions.find(ca => ca.codes.includes(num));
    return match ? match.message : "Other Issue / Failure Analysis";
};

const StationBreakdownPage = () => {
    const location = useLocation();
    const { state, dispatch } = useGlobalSettings();

    // Date range state
    const [startDate, setStartDate] = useState(getInitialStartDate());
    const [endDate, setEndDate] = useState(normalizeDate.end(new Date()));


    // UI state
    const [itemsPerPage, setItemsPer] = useState(3);

    const [data, setData] = useState([]);
    const [model, setModel] = useState(null);
    const [part, setPart] = useState(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);

    const transformData = useCallback((rawData) => {
        const grouped = {};

        rawData.forEach(item => {
            const key = `${item.model}|${item.pn}|${item.workstation_name}`;
            
            if (!grouped[key]) {
                grouped[key] = {
                    model: item.model,
                    partNumber: item.pn,
                    workstation: item.workstation_name,
                    totalPassed: 0,
                    totalFailed: 0,
                    errorCodes: {}
                };
            }

            // Count passed/failed
            grouped[key][item.history_station_passing_status === 'Pass' ? 'totalPassed' : 'totalFailed']++;

            // Group by error code
            if (item.error_code) {
                let shortCode = String(item.error_code).slice(-3);
                if (shortCode === '_na' && item.error_code.length >= 6){ shortCode = String(item.error_code).slice(-6,-3);}
                if (shortCode === '-WS'){ shortCode = 'EC-WS';}
                
                if (!grouped[key].errorCodes[shortCode]) {
                    grouped[key].errorCodes[shortCode] = {
                        count: 0,
                        descriptions: []
                    };
                }
                grouped[key].errorCodes[shortCode].count++;
                if (item.description && !grouped[key].errorCodes[shortCode].descriptions.includes(item.description)) {
                    grouped[key].errorCodes[shortCode].descriptions.push(item.description);
                }
            }
        });

        // Convert to array
        return Object.values(grouped).map(group => ({
            ...group,
            errorCodes: Object.entries(group.errorCodes)
                .map(([error_code, data]) => ({
                    error_code,
                    count: data.count,
                    descriptions: data.descriptions,
                    action: getCodeAction(error_code)
                }))
                .filter(ec => ec.error_code.trim().toLowerCase() !== 'nan') // Filter here once
                .sort((a, b) => b.count - a.count) // Sort here once
        }));
    }, []);

    useEffect(() => {
        let cancelled = false;
        
        async function loadData() {
            setLoading(true);
            setError(null);
            try {
                const result = await fetchDiveData(API_BASE, startDate, endDate);
                if (!cancelled) {
                    const transformed = transformData(result);
                    setData(transformed);
                }
            } catch (err) {
                if (!cancelled) {
                    setError(err);
                }
            } finally {
                if (!cancelled) {
                    setLoading(false);
                }
            }
        }
        
        loadData();
        
        return () => {
            cancelled = true;
        };
    }, [startDate, endDate]);

    const modelOptions = useMemo(() =>{
        if(!Array.isArray(data)) return [];
        return [...new Set(data.map(r => r.model).filter(Boolean))].sort();
    },[data])
    
    const partOptions = useMemo(() =>{
        if(!Array.isArray(data)) return [];
        const base = (model === '' || model === null) ? data : data.filter(r => r.model === model);
        return [...new Set(base.map(r => r.partNumber).filter(Boolean))].sort();
    },[data,model])

    const filteredData = useMemo(() =>{
        const base = (model === '' || model === null) ? data : data.filter(r => r.model === model);
        const step = (part === '' || part === null) ? base : base.filter(r => r.partNumber === part);
        return [...step].sort((a, b) => {
            const aFailed = Number(a.totalFailed) || 0;
            const bFailed = Number(b.totalFailed) || 0;
            return bFailed - aFailed; // desc
        });
    },[data,model,part])

    const chartData = useMemo(() => {
        if (!Array.isArray(filteredData)) return [];

        const byStation = {};

        filteredData.forEach((r) => {
            const station = r.workstation;
            if (!station) return;

            const pass = Number(r.totalPassed) || 0;
            const fail = Number(r.totalFailed) || 0;

            if (!byStation[station]) {
                byStation[station] = { pass: 0, fail: 0 };
            }

            byStation[station].pass += pass;
            byStation[station].fail += fail;
        });

        return Object.entries(byStation)
            .map(([station, totals]) => {
                const total = totals.pass + totals.fail;
                return {
                    station,
                    pass: totals.pass,
                    fail: totals.fail,
                    failurerate: total ? totals.fail / total : 0,
                };
            })
            .filter(r => r.fail > 0)
            .sort((a, b) => b.fail - a.fail);
    }, [filteredData]);

    useEffect(() => {
        if (model === null && modelOptions.length > 0) {
            setPart("");
            setModel(modelOptions[0]);
        }
        // if current model disappears after date/model changes, snap to first
        if (model && model !== '' && modelOptions.length > 0 && !modelOptions.includes(model)) {
            setPart("");
            setModel(modelOptions[0]);
        }
    }, [model, modelOptions]);


  // Theme and style
  const theme = useTheme();
  const style = {
        border: 'solid',
        padding: '10px 8px',
        borderColor: theme.palette.divider,
        backgroundColor: theme.palette.mode === 'dark' ? theme.palette.primary.dark : theme.palette.primary.light,
        fontSize: '14px',
        left: 0,
        zIndex: 5,
        boxShadow: '2px 0 5px rgba(0,0,0,0.1)',
    };

    const handleExport = useCallback(() => {
        if (!filteredData.length) {
            alert('No data to export');
            return;
        }

        const rows = [];
        filteredData.forEach(ws => {
            if (ws.errorCodes.length === 0) {
                rows.push({
                    workstation: ws.workstation,
                    model: ws.model,
                    total_passed: ws.totalPassed,
                    total_failed: ws.totalFailed,
                    error_code: '',
                    count: '',
                    descriptions: '',
                    action: ''
                });
            } else {
                ws.errorCodes.forEach(ec => {
                    rows.push({
                        workstation: ws.workstation,
                        model: ws.model,
                        total_passed: ws.totalPassed,
                        total_failed: ws.totalFailed,
                        error_code: ec.error_code,
                        count: ec.count,
                        descriptions: ec.descriptions.join(' | '),
                        action: ec.action
                    });
                });
            }
        });

        const headers = ['workstation', 'model', 'total_passed', 'total_failed', 'error_code', 'count', 'descriptions', 'action'];
        const escape = (val) => {
            const s = String(val ?? '');
            return s.includes(',') || s.includes('"') || s.includes('\n')
                ? `"${s.replace(/"/g, '""')}"`
                : s;
        };

        const csv = [
            headers.join(','),
            ...rows.map(row => headers.map(h => escape(row[h])).join(','))
        ].join('\n');

        const blob = new Blob([csv], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `station_breakdown_${model ?? 'all'}_${new Date().toISOString().slice(0, 10)}.csv`;
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
    }, [filteredData, model]);

    const getActionPieData = useCallback((errorCodes) => {
        const actionCounts = {};
        
        errorCodes.forEach(ec => {
            const action = ec.action;
            actionCounts[action] = (actionCounts[action] || 0) + ec.count;
        });
        
        return Object.entries(actionCounts).map(([action, count]) => ({
            status: action,
            value: count
        }));
    }, []);

    const combinedActionPieData = useMemo(() => {
        const topStations = filteredData.slice(0, itemsPerPage);
        const actionCounts = {};
        topStations.forEach(ws => {
            ws.errorCodes.forEach(ec => {
                const action = ec.action;
                actionCounts[action] = (actionCounts[action] || 0) + ec.count;
            });
        });
        return Object.entries(actionCounts).map(([action, count]) => ({
            status: action,
            value: count
        }));
    }, [filteredData, itemsPerPage]);

  // Render
    return (
        <Box p={1}>
            <Header
                title="Station Error Breakdown"
                subTitle="Break down of error codes on stations"
            />
            <Box sx={toolbarStyle} >
                <DateRange
                    startDate={startDate}
                    setStartDate={setStartDate}
                    normalizeStart={normalizeDate.start}
                    endDate={endDate}
                    setEndDate={setEndDate}
                    normalizeEnd={normalizeDate.end}
                    inline = {true}
                />
                <NumberRange defaultNumber={itemsPerPage} setNumber={setItemsPer} label="# Stations" />
                <TextField
                    select
                    size="small"
                    label="Model"
                    value={model??""}
                    onChange={(e) => {
                        setModel(e.target.value);
                        setPart("");
                    }}
                    sx={{ minWidth: 200 }}
                >
                    <MenuItem value="">
                        <em>All Models</em>
                    </MenuItem>

                    {modelOptions.map(m => (
                        <MenuItem key={m} value={m}>
                        {m}
                        </MenuItem>
                    ))}
                </TextField>
                <TextField
                    select
                    size="small"
                    label="Part"
                    value={part??""}
                    onChange={(e) => setPart(e.target.value)}
                    sx={{ minWidth: 200 }}
                >
                    <MenuItem value="">
                        <em>All Part Numbers</em>
                    </MenuItem>

                    {partOptions.map(m => (
                        <MenuItem key={m} value={m}>
                        {m}
                        </MenuItem>
                    ))}
                </TextField>
                <Button
                    variant='contained'
                    size='small'
                    onClick={handleExport}
                    disabled={!filteredData.length}
                >
                    Export
                </Button>

            </Box>
            <Box>
                <TestStationChart
                    label={`${model}${part === "" || part === null ? "" : ` - ${part}`}`}
                    data = {chartData}
                    loading = {loading}
                />
            </Box>
            {combinedActionPieData.length > 0 && (
                <Box sx={{ mt: 2 }}>
                    <PieChart
                        label={`Top ${itemsPerPage} Stations — Action Breakdown`}
                        data={combinedActionPieData}
                        getPercent={false}
                        showTag={true}
                        loading={loading}
                    />
                </Box>
            )}
            <Box sx={{ mt: 2 }}>
                {filteredData.slice(0, itemsPerPage).map(ws => {
                    const actionPieData = getActionPieData(ws.errorCodes);
                    
                    return (
                        <Box key={`${ws.model}|${ws.partNumber}|${ws.workstation}`} sx={{ mb: 3 }}>
                            <TableContainer
                                component={Paper}
                                sx={{ mb: 2, p: 1 }}
                            >
                                <Typography variant="subtitle1" sx={{ px: 1, pb: 1 }}>
                                    {ws.workstation} — Failed: {ws.totalFailed} | Passed: {ws.totalPassed}
                                </Typography>

                                <Table size="small">
                                    <TableHead>
                                        <TableRow>
                                            <TableCell>Error Code</TableCell>
                                            <TableCell align="right">Count</TableCell>
                                            <TableCell>Descriptions</TableCell>
                                            <TableCell>Action</TableCell>
                                        </TableRow>
                                    </TableHead>

                                    <TableBody>
                                        {ws.errorCodes.length === 0 ? (
                                            <TableRow>
                                                <TableCell colSpan={4}><em>No error codes</em></TableCell>
                                            </TableRow>
                                        ) : (
                                            ws.errorCodes.map(ec => (
                                                <TableRow key={`${ws.workstation}|${ec.error_code}`}>
                                                    <TableCell>{ec.error_code}</TableCell>
                                                    <TableCell align="right">{ec.count}</TableCell>
                                                    <TableCell>
                                                        {ec.descriptions.length ? (() => {
                                                            const full = ec.descriptions.join(' | ');
                                                            const truncated = full.length > maxDescLength ? `${full.slice(0, maxDescLength)}…` : full;

                                                            return (
                                                                <span title={full} style={{ cursor: 'help' }}>
                                                                    {truncated}
                                                                </span>
                                                            );
                                                        })() : (
                                                            <em>No descriptions</em>
                                                        )}
                                                    </TableCell>

                                                    <TableCell>{ec.action}</TableCell>
                                                </TableRow>
                                            ))
                                        )}
                                    </TableBody>
                                </Table>
                            </TableContainer>

                            {/* Pie Chart for Actions */}
                            {ws.errorCodes.length > 0 && (
                                <PieChart
                                    label={`${ws.workstation} - Action Breakdown`}
                                    data={actionPieData}
                                    getPercent={false}
                                    showTag={true}
                                    loading={false}
                                />
                            )}
                        </Box>
                    );
                })}
            </Box>
        </Box>
        
    );
};

export default StationBreakdownPage;