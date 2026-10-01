import React, { useState } from 'react';
import { View, TouchableOpacity, StyleSheet } from 'react-native';
import { Text } from '../ui/GameText';
import { colors } from '../../theme';
import { homeExamples } from './examples';

function Arrow({ down = false }) {
  return <View accessible={false} style={[styles.arrow, down && styles.arrowDown]}>
    <View style={styles.arrowLine} /><View style={styles.arrowHead} />
  </View>;
}

function CameraIcon() {
  return <View accessible={false} style={styles.camera}>
    <View style={[styles.reel, { left: 0 }]} /><View style={[styles.reel, { left: 11 }]} />
    <View style={styles.cameraBody} /><View style={styles.cameraLens} />
  </View>;
}

function PencilIcon() {
  return <View accessible={false} style={styles.pencil}>
    <View style={styles.pencilBody} /><View style={styles.pencilTip} />
  </View>;
}

export function PeopleIcon() {
  return <View accessible={false} style={styles.people}>
    {[0, 1, 2].map((i) => <View key={i} style={[styles.person, { left: i * 12, top: i === 1 ? 0 : 6 }]}>
      <View style={styles.personHead} /><View style={styles.personBody} />
    </View>)}
  </View>;
}

function StepHeading({ number, children, tone, wide }) {
  return <View style={styles.stepHeading}>
    <View style={[styles.stepNumber, { backgroundColor: tone }]}><Text style={styles.stepDigit}>{number}</Text></View>
    <Text style={[styles.stepLabel, wide && styles.stepLabelWide]}>{children}</Text>
  </View>;
}

export default function HomeDemo({ horizontal = false }) {
  const [kind, setKind] = useState(0);
  const [width, setWidth] = useState(0);
  const [selected, setSelected] = useState(null);
  const [feedback, setFeedback] = useState('');
  const example = homeExamples[kind];
  const wide = horizontal && width >= 700;
  const candidates = [example.other, example.real, example.written];

  function changeKind(index) {
    setKind(index);
    setSelected(null);
    setFeedback('');
  }

  function choose(index) {
    if (index === 2) {
      setFeedback('自分が考えたウソは選べないよ。');
      return;
    }
    setSelected(index);
    setFeedback(index === 1 ? '正解！ これが本物の題名。' : `これはウソ。本物は「${example.real}」。`);
  }

  return <View style={styles.panel} onLayout={(event) => setWidth(event.nativeEvent.layout.width)}>
    <View style={[styles.demoHeader, wide && styles.demoHeaderWide]}>
      <Text style={[styles.demoTitle, wide && styles.demoTitleWide]}>遊びの見本</Text>
      <View style={styles.tabs} accessibilityRole="tablist">
        {homeExamples.map((item, index) => <TouchableOpacity key={item.kind}
          accessibilityRole="tab" accessibilityLabel={`${item.kind}の見本`}
          aria-selected={kind === index}
          accessibilityState={{ selected: kind === index }}
          onPress={() => changeKind(index)} style={[styles.tab, kind === index && styles.activeTab]}>
          <Text style={[styles.tabText, wide && styles.tabTextWide]}>{item.kind}</Text>
        </TouchableOpacity>)}
      </View>
    </View>

    <View style={[styles.flow, wide && styles.flowWide]}>
      <View style={[styles.stage, wide && styles.storyStage]}>
        <StepHeading number="1" tone={colors.cyan} wide={wide}>あらすじ</StepHeading>
        <View style={[styles.stageBody, wide && styles.stageBodyWide]}>
          <View style={[styles.storyPaper, wide && styles.storyPaperWide]}>
            <CameraIcon />
            <Text style={[styles.synopsis, wide && styles.synopsisWide]}>{example.synopsis}</Text>
          </View>
        </View>
      </View>

      <Arrow down={!wide} />

      <View style={[styles.stage, wide && styles.writingStage]}>
        <StepHeading number="2" tone={colors.yellow} wide={wide}>ウソをつくる</StepHeading>
        <View style={[styles.stageBody, wide && styles.stageBodyWide]}>
          <View style={styles.writingPaper}>
            <Text style={[styles.written, wide && styles.writtenWide]}>{example.written}</Text>
            <View style={styles.writtenRule} /><PencilIcon />
          </View>
        </View>
      </View>

      <Arrow down={!wide} />

      <View style={[styles.stage, wide && styles.choiceStage]}>
        <StepHeading number="3" tone={colors.pink} wide={wide}>本物はどれ？</StepHeading>
        <View style={[styles.stageBody, styles.choiceStack, wide && styles.stageBodyWide]}>
          {candidates.map((title, index) => <TouchableOpacity key={`${kind}-${index}`}
            accessibilityRole="button" accessibilityLabel={`見本の題名 ${title}`}
            aria-pressed={selected === index}
            accessibilityState={{ selected: selected === index }} onPress={() => choose(index)}
            style={[styles.choice, selected === index && (index === 1 ? styles.correctChoice : styles.wrongChoice)]}>
            <Text style={[styles.choiceText, wide && styles.choiceTextWide]}>{title}</Text>
          </TouchableOpacity>)}
        </View>
      </View>
    </View>

    {feedback ? <Text style={[styles.feedback, selected === 1 && styles.correctFeedback]}
      accessibilityRole="alert" accessibilityLiveRegion="polite">{feedback}</Text> : null}
    <View style={styles.featureRow}>
      <PeopleIcon /><Text style={styles.featureText}>4〜6人で遊べる　・　知らなくても遊べる</Text>
    </View>
  </View>;
}

const styles = StyleSheet.create({
  panel: { borderWidth: 1, borderColor: '#A5E8EE', borderRadius: 18, backgroundColor: '#FFF7E8', padding: 22 },
  demoHeader: { gap: 8, borderBottomWidth: 1, borderBottomColor: colors.border, paddingBottom: 0 },
  demoHeaderWide: { flexDirection: 'row', alignItems: 'center', gap: 18 },
  demoTitle: { color: colors.navy, fontWeight: '700', fontSize: 20, lineHeight: 28 },
  demoTitleWide: { fontSize: 24, lineHeight: 34, minWidth: 155 },
  tabs: { flexDirection: 'row', flex: 1, minHeight: 48 },
  tab: { flex: 1, alignItems: 'center', justifyContent: 'center', minHeight: 48, borderBottomWidth: 4, borderBottomColor: 'transparent', borderTopLeftRadius: 6, borderTopRightRadius: 6 },
  activeTab: { backgroundColor: '#C4F0F4', borderBottomColor: '#15C1D4' },
  tabText: { color: colors.navy, fontWeight: '700', fontSize: 15, lineHeight: 24 },
  tabTextWide: { fontSize: 19, lineHeight: 28 },
  flow: { gap: 14, paddingTop: 22 },
  flowWide: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingTop: 24 },
  stage: { width: '100%' },
  storyStage: { flex: 1.4, width: 'auto', minWidth: 0 },
  writingStage: { flex: 0.95, width: 'auto', minWidth: 0 },
  choiceStage: { flex: 1.12, width: 'auto', minWidth: 0 },
  stepHeading: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 14 },
  stepNumber: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  stepDigit: { color: colors.navy, fontWeight: '700', fontSize: 23, lineHeight: 30 },
  stepLabel: { color: colors.navy, fontWeight: '700', fontSize: 18, lineHeight: 28 },
  stepLabelWide: { fontSize: 21, lineHeight: 30 },
  stageBody: { justifyContent: 'center' },
  stageBodyWide: { minHeight: 208 },
  storyPaper: { backgroundColor: colors.white, borderColor: colors.border, borderWidth: 1, borderRadius: 7, padding: 22, shadowColor: '#62D9E9', shadowOffset: { width: 3, height: 6 }, shadowOpacity: 0.5, shadowRadius: 0 },
  storyPaperWide: { minHeight: 202, paddingHorizontal: 24, paddingVertical: 22 },
  synopsis: { color: colors.navy, fontSize: 16, lineHeight: 27, marginTop: 9 },
  synopsisWide: { fontSize: 18, lineHeight: 29 },
  writingPaper: { minHeight: 112, justifyContent: 'center', backgroundColor: colors.white, borderColor: colors.border, borderWidth: 1, borderRadius: 6, paddingHorizontal: 14, paddingVertical: 26, marginHorizontal: 4, transform: [{ rotate: '1deg' }], shadowColor: '#62D9E9', shadowOffset: { width: 4, height: 7 }, shadowOpacity: 0.5, shadowRadius: 0 },
  written: { color: colors.navy, fontSize: 22, lineHeight: 30, fontStyle: 'italic', textAlign: 'center', transform: [{ rotate: '-5deg' }] },
  writtenWide: { fontSize: 19, lineHeight: 28 },
  writtenRule: { height: 2, backgroundColor: '#26CBE0', marginTop: 8, transform: [{ rotate: '-5deg' }] },
  choiceStack: { gap: 8 },
  choice: { minHeight: 48, backgroundColor: colors.white, borderColor: colors.navy, borderWidth: 2, borderRadius: 7, paddingVertical: 10, paddingHorizontal: 10, alignItems: 'center', justifyContent: 'center' },
  choiceText: { color: colors.navy, fontSize: 16, lineHeight: 23, textAlign: 'center', fontWeight: '700' },
  choiceTextWide: { fontSize: 14, lineHeight: 23 },
  correctChoice: { borderColor: '#208A52', backgroundColor: '#E6F6EB' },
  wrongChoice: { borderColor: colors.red, backgroundColor: '#FFF0F1' },
  feedback: { color: colors.redDark, fontSize: 14, lineHeight: 23, marginTop: 16, textAlign: 'center' },
  correctFeedback: { color: '#208A52' },
  featureRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, justifyContent: 'center', alignItems: 'center', borderTopWidth: 1, borderTopColor: colors.border, marginTop: 24, paddingTop: 18 },
  featureText: { color: colors.navy, fontWeight: '700', fontSize: 14, lineHeight: 24, flexShrink: 1, textAlign: 'center' },
  arrow: { width: 30, height: 22, position: 'relative', alignSelf: 'center', flexShrink: 0 },
  arrowDown: { transform: [{ rotate: '90deg' }], marginVertical: 2 },
  arrowLine: { width: 25, height: 3, backgroundColor: colors.navy, position: 'absolute', top: 10, left: 0 },
  arrowHead: { width: 14, height: 14, borderTopWidth: 3, borderRightWidth: 3, borderColor: colors.navy, position: 'absolute', top: 4, right: 2, transform: [{ rotate: '45deg' }] },
  camera: { width: 30, height: 25, position: 'relative' },
  reel: { position: 'absolute', top: 0, width: 10, height: 10, borderWidth: 3, borderColor: colors.navy, borderRadius: 5 },
  cameraBody: { position: 'absolute', top: 9, left: 1, width: 21, height: 14, borderRadius: 2, backgroundColor: colors.navy },
  cameraLens: { position: 'absolute', right: 0, top: 10, width: 0, height: 0, borderTopWidth: 6, borderBottomWidth: 6, borderRightWidth: 8, borderTopColor: 'transparent', borderBottomColor: 'transparent', borderRightColor: colors.navy },
  pencil: { position: 'absolute', right: 2, bottom: -14, width: 16, height: 54, transform: [{ rotate: '36deg' }] },
  pencilBody: { width: 14, height: 42, borderWidth: 3, borderColor: colors.navy, backgroundColor: colors.yellow, borderTopLeftRadius: 4, borderTopRightRadius: 4 },
  pencilTip: { width: 0, height: 0, borderLeftWidth: 7, borderRightWidth: 7, borderTopWidth: 12, borderLeftColor: 'transparent', borderRightColor: 'transparent', borderTopColor: colors.navy },
  people: { width: 40, height: 35, position: 'relative' },
  person: { width: 16, height: 29, position: 'absolute' },
  personHead: { width: 12, height: 12, borderRadius: 6, backgroundColor: '#20C9DE', alignSelf: 'center' },
  personBody: { width: 16, height: 15, borderTopLeftRadius: 8, borderTopRightRadius: 8, backgroundColor: '#20C9DE', marginTop: 2 },
});
