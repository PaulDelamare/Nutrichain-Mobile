import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { BRAND } from '@/lib/theme';

interface Option {
  value: string;
  label: string;
}

interface OptionPickerProps {
  label: string;
  options: Option[];
  selected: string;
  onSelect: (value: string) => void;
}

/**
 * Puces tactiles plutôt qu'un menu déroulant : sélectionnable avec des gants, sans viser.
 *
 * Elles reviennent à la ligne au lieu de défiler horizontalement. Le défilement tranchait la
 * dernière option en deux au bord de l'écran, sans rien indiquer : l'opérateur croyait la liste
 * finie et choisissait le mauvais fournisseur — parmi ceux qu'il pouvait voir.
 */
export function OptionPicker({ label, options, selected, onSelect }: OptionPickerProps) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>

      {options.length === 0 ? (
        <Text style={styles.empty}>Aucune option disponible</Text>
      ) : (
        <View style={styles.row}>
          {options.map((option) => {
            const isSelected = option.value === selected;
            return (
              <TouchableOpacity
                key={option.value}
                style={[styles.chip, isSelected && styles.chipSelected]}
                onPress={() => onSelect(option.value)}
                activeOpacity={0.8}
              >
                <Text style={[styles.chipText, isSelected && styles.chipTextSelected]}>
                  {option.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  field: { gap: 8 },
  label: { fontSize: 13, fontWeight: '600', color: '#374151' },
  empty: { fontSize: 13, color: '#9CA3AF', fontStyle: 'italic' },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    // Une puce ne dépasse jamais la largeur de l'écran : un nom de client à rallonge (« E2E-Customer-…»)
    // pousserait sinon toute la ligne hors du cadre.
    flexShrink: 1,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 10,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  chipSelected: { backgroundColor: BRAND.primary, borderColor: BRAND.primary },
  chipText: { fontSize: 14, color: '#374151', fontWeight: '500' },
  chipTextSelected: { color: '#fff', fontWeight: '700' },
});
