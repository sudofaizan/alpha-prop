//+------------------------------------------------------------------+
//| AlphaFXBridge.mq5 — ticks + multi-TF OHLC history to Tick Hub    |
//| Attach ONE instance to any chart (all symbols via inputs).       |
//+------------------------------------------------------------------+
#property copyright "AlphaFX"
#property version   "1.20"
#property strict

input string InpHubHost         = "127.0.0.1";
input int    InpHubPort         = 9001;
input string InpSymbols         = "EURUSD,XAUUSD,BTCUSD,GBPUSD,USDJPY";
input int    InpTimerMs         = 100;
input int    InpBarCount        = 300;
input int    InpBarIntervalSec  = 60;
input int    InpHeartbeatSec    = 5;

string   TF_NAMES[]   = {"M1", "M5", "M15", "M30", "H1", "H4", "D1", "W1", "MN1"};
ENUM_TIMEFRAMES TF_PERIODS[] = {
   PERIOD_M1, PERIOD_M5, PERIOD_M15, PERIOD_M30,
   PERIOD_H1, PERIOD_H4, PERIOD_D1, PERIOD_W1, PERIOD_MN1
};

int      socketHandle = INVALID_HANDLE;
string   symbols[];
double   lastBid[];
datetime lastBarPublish = 0;
datetime lastHeartbeat  = 0;

//+------------------------------------------------------------------+
int OnInit()
  {
   StringSplit(InpSymbols, ',', symbols);
   ArrayResize(lastBid, ArraySize(symbols));
   ArrayInitialize(lastBid, 0.0);
   EventSetMillisecondTimer(MathMax(50, InpTimerMs));
   if(!ConnectHub())
      Print("AlphaFXBridge: waiting for hub at ", InpHubHost, ":", InpHubPort);
   else
      PublishAllBars();
   return(INIT_SUCCEEDED);
  }

//+------------------------------------------------------------------+
void OnDeinit(const int reason)
  {
   EventKillTimer();
   DisconnectHub();
  }

//+------------------------------------------------------------------+
void OnTimer()
  {
   if(socketHandle == INVALID_HANDLE)
     {
      if(ConnectHub())
         PublishAllBars();
      return;
     }

   for(int i = 0; i < ArraySize(symbols); i++)
      PublishTick(NormalizeSym(symbols[i]), i);

   if(TimeCurrent() - lastBarPublish >= MathMax(1, InpBarIntervalSec))
      PublishAllBars();

   SendHeartbeat();
  }

//+------------------------------------------------------------------+
void OnTick()
  {
   if(socketHandle == INVALID_HANDLE)
      return;
   int idx = SymbolIndex(_Symbol);
   if(idx >= 0)
      PublishTick(_Symbol, idx);
  }

//+------------------------------------------------------------------+
string NormalizeSym(string sym)
  {
   string s = sym;
   StringTrimLeft(s);
   StringTrimRight(s);
   return s;
  }

//+------------------------------------------------------------------+
int SymbolIndex(string sym)
  {
   string s = NormalizeSym(sym);
   for(int i = 0; i < ArraySize(symbols); i++)
      if(NormalizeSym(symbols[i]) == s)
         return i;
   return -1;
  }

//+------------------------------------------------------------------+
void PublishTick(string sym, int idx)
  {
   string s = NormalizeSym(sym);
   if(s == "")
      return;

   MqlTick tick;
   if(!SymbolInfoTick(s, tick))
      return;
   if(tick.bid <= 0 || tick.ask <= 0)
      return;
   if(MathAbs(tick.bid - lastBid[idx]) < 0.0000001)
      return;
   lastBid[idx] = tick.bid;

   string json = StringFormat(
      "{\"type\":\"tick\",\"symbol\":\"%s\",\"bid\":%.10f,\"ask\":%.10f,\"time_ms\":%I64d,\"source\":\"mt5\"}\n",
      s,
      tick.bid,
      tick.ask,
      (long)tick.time_msc
   );
   SendLine(json);
  }

//+------------------------------------------------------------------+
void PublishAllBars()
  {
   int tfCount = ArraySize(TF_NAMES);
   for(int i = 0; i < ArraySize(symbols); i++)
     {
      string sym = NormalizeSym(symbols[i]);
      for(int t = 0; t < tfCount; t++)
         PublishBars(sym, TF_NAMES[t], TF_PERIODS[t]);
     }
   lastBarPublish = TimeCurrent();
  }

//+------------------------------------------------------------------+
void PublishBars(string sym, string tfName, ENUM_TIMEFRAMES period)
  {
   if(sym == "")
      return;

   MqlRates rates[];
   ArraySetAsSeries(rates, true);
   int n = CopyRates(sym, period, 0, InpBarCount, rates);
   if(n <= 0)
     {
      Print("AlphaFXBridge: CopyRates failed ", sym, " ", tfName, " err=", GetLastError());
      return;
     }

   string json = "{\"type\":\"bars\",\"symbol\":\"" + sym + "\",\"timeframe\":\"" + tfName + "\",\"source\":\"mt5\",\"bars\":[";
   bool first = true;
   for(int i = n - 1; i >= 0; i--)
     {
      if(!first)
         json += ",";
      first = false;
      json += StringFormat(
         "{\"time\":%I64d,\"open\":%.10f,\"high\":%.10f,\"low\":%.10f,\"close\":%.10f}",
         (long)rates[i].time,
         rates[i].open,
         rates[i].high,
         rates[i].low,
         rates[i].close
      );
     }
   json += "]}\n";
   SendLine(json);
  }

//+------------------------------------------------------------------+
void SendHeartbeat()
  {
   if(TimeCurrent() - lastHeartbeat < MathMax(1, InpHeartbeatSec))
      return;
   SendLine("{\"type\":\"heartbeat\",\"service\":\"alphafx-bridge\"}\n");
   lastHeartbeat = TimeCurrent();
  }

//+------------------------------------------------------------------+
bool ConnectHub()
  {
   DisconnectHub();
   socketHandle = SocketCreate();
   if(socketHandle == INVALID_HANDLE)
     {
      Print("AlphaFXBridge: SocketCreate failed ", GetLastError());
      return false;
     }
   if(!SocketConnect(socketHandle, InpHubHost, InpHubPort, 2000))
     {
      Print("AlphaFXBridge: connect failed ", GetLastError());
      SocketClose(socketHandle);
      socketHandle = INVALID_HANDLE;
      return false;
     }
   Print("AlphaFXBridge: connected to hub ", InpHubHost, ":", InpHubPort);
   return true;
  }

//+------------------------------------------------------------------+
void DisconnectHub()
  {
   if(socketHandle != INVALID_HANDLE)
     {
      SocketClose(socketHandle);
      socketHandle = INVALID_HANDLE;
     }
  }

//+------------------------------------------------------------------+
void SendLine(string line)
  {
   if(socketHandle == INVALID_HANDLE)
      return;
   uchar data[];
   int len = StringToCharArray(line, data, 0, WHOLE_ARRAY, CP_UTF8) - 1;
   if(len <= 0)
      return;
   int sent = SocketSend(socketHandle, data, len);
   if(sent != len)
     {
      Print("AlphaFXBridge: send failed, reconnecting");
      DisconnectHub();
     }
  }
//+------------------------------------------------------------------+
